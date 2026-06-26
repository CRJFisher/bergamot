/**
 * The production `ClusterSink` (TASK-36.6) — the extension's single DuckDB writer
 * persisting one window's clustering result idempotently to `topic_run` /
 * `topic_cluster` / `topic_cluster_member` (tdt-hdbscan-micro-tier-plan.md §8).
 *
 * The pure `@bergamot/tdt` library computes a fully-keyed {@link RunBundle}
 * (run id, params hash, input fingerprint, the cluster + member rows) and hands
 * it here; this store owns the transactional read-decide-write that the pure
 * library cannot, because the no-op / atomic-replace / supersede decision depends
 * on what is already on disk:
 *
 *   - **no-op** — a `complete` run with this id and an unchanged `input_fingerprint`
 *     already exists. Nothing is written (the cheap quiet-day path the §11 trigger
 *     relies on).
 *   - **atomic replace** — the same run id exists with a different `input_fingerprint`
 *     (re-embedding, or a late-arriving visit landing in a closed window). The
 *     run's clusters/members are deleted and repopulated in one transaction; the
 *     run row's `created_at` is preserved.
 *   - **create** — no run with this id exists (a changed model/params/algo yields a
 *     new id). It is inserted, and any OTHER live run for the same window is marked
 *     `superseded` in the same transaction, so exactly one `complete` run per
 *     window survives (history retained).
 *
 * Like {@link PageVectorStore}, this is a thin wrapper over the shared {@link DuckDB}
 * handle the extension already owns read-write — it never opens its own connection
 * (the single-writer guarantee, plan §3).
 *
 * Cross-table references are SOFT refs (no FOREIGN KEY): DuckDB rejects
 * `ON DELETE CASCADE` and cannot delete a FK parent and child in one transaction,
 * which would make the atomic-replace path impossible. Integrity is upheld here —
 * a run's three tables are always written and deleted together in one transaction.
 */
import { DuckDBValue, listValue } from "@duckdb/node-api";
import {
  DuckDB,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
} from "../duck_db";
import type {
  ClusterSink,
  RunBundle,
  PersistResult,
  RunRecord,
  ClusterRecord,
  MemberRecord,
} from "@bergamot/tdt";

/** Per-window coverage, derivable from `topic_cluster_member` alone (plan §8). */
export interface WindowCoverage {
  run_id: string;
  total: number;
  clustered: number;
  noise: number;
  /** clustered / total, or 0 for an empty run (no divide-by-zero). */
  coverage: number;
}

/** A SQL statement runner bound to one transaction connection. */
type TxRun = (
  sql: string,
  params?: Record<string, DuckDBValue>,
) => Promise<void>;

/**
 * The "other live run for this window" predicate, shared verbatim by the
 * pre-transaction SELECT (which builds the report) and the in-transaction
 * supersede UPDATE, so the rows reported and the rows flipped can never diverge.
 * Binds $ws / $we / $id.
 */
const OTHER_LIVE_RUN_FOR_WINDOW = `window_start = $ws AND window_end = $we
   AND status = 'complete' AND id != $id`;

export class ClusterStore implements ClusterSink {
  constructor(private readonly db: DuckDB) {}

  /**
   * Persist one run+clusters+members idempotently. The bundle MUST be an
   * `assemble_run_bundle` output — persist does not re-validate internal
   * consistency (members' cluster_ids ⊆ clusters, counts, etc.); the pure
   * assembler is the single producer that guarantees it.
   *
   * Reads the existing run for the bundle's id on the shared connection BEFORE the
   * write transaction — safe under the single-writer model (the extension is the
   * only writer; the §11 trigger's single-flight guard prevents two TDT runs
   * overlapping), so there is no TOCTOU race. Mirrors `right_to_forget.ts`, which
   * likewise resolves its targets before its `isolated_transaction`.
   *
   * The "exactly one complete run per window" invariant is upheld per branch:
   * noop leaves the table untouched; replace keeps the same id and re-completes
   * it; create inserts a new id. Replace and create both run the supersede UPDATE,
   * retiring every OTHER complete run for the window. No DB constraint enforces the
   * invariant (DuckDB has no partial unique index) — it lives in this control flow.
   */
  async persist(bundle: RunBundle): Promise<PersistResult> {
    const { run, clusters, members } = bundle;

    const existing = await this.db.query_first<{
      input_fingerprint: string;
      status: string;
    }>(
      `SELECT input_fingerprint, status FROM ${TOPIC_RUN_TABLE} WHERE id = $id`,
      { id: run.id },
    );

    if (
      existing &&
      existing.status === "complete" &&
      existing.input_fingerprint === run.input_fingerprint
    ) {
      return { run_id: run.id, outcome: "noop", superseded_run_ids: [] };
    }

    const is_replace = existing !== null;

    // Every OTHER live run for this window is superseded — in BOTH the replace and
    // create paths. Read the ids now for the report; the transaction re-applies the
    // identical predicate atomically.
    const prior_live = await this.db.query<{ id: string }>(
      `SELECT id FROM ${TOPIC_RUN_TABLE} WHERE ${OTHER_LIVE_RUN_FOR_WINDOW}`,
      { ws: run.window_start, we: run.window_end, id: run.id },
    );
    const superseded_run_ids = prior_live.map((r) => String(r.id));

    await this.db.isolated_transaction(async (tx_run) => {
      if (is_replace) {
        await tx_run(
          `DELETE FROM ${TOPIC_CLUSTER_MEMBER_TABLE} WHERE run_id = $id`,
          { id: run.id },
        );
        await tx_run(`DELETE FROM ${TOPIC_CLUSTER_TABLE} WHERE run_id = $id`, {
          id: run.id,
        });
      }

      if (superseded_run_ids.length > 0) {
        await tx_run(
          `UPDATE ${TOPIC_RUN_TABLE} SET status = 'superseded'
           WHERE ${OTHER_LIVE_RUN_FOR_WINDOW}`,
          { ws: run.window_start, we: run.window_end, id: run.id },
        );
      }

      if (is_replace) {
        // Preserve created_at: only the data-drift columns and completion change.
        await tx_run(
          `UPDATE ${TOPIC_RUN_TABLE} SET
             input_count = $input_count,
             input_fingerprint = $input_fingerprint,
             cluster_count = $cluster_count,
             noise_count = $noise_count,
             status = 'complete',
             completed_at = $completed_at
           WHERE id = $id`,
          {
            id: run.id,
            input_count: run.input_count,
            input_fingerprint: run.input_fingerprint,
            cluster_count: run.cluster_count,
            noise_count: run.noise_count,
            completed_at: run.completed_at,
          },
        );
      } else {
        await insert_run(tx_run, run);
      }

      for (const cluster of clusters) await insert_cluster(tx_run, cluster);
      for (const member of members) await insert_member(tx_run, member);
    });

    return {
      run_id: run.id,
      outcome: is_replace ? "replaced" : "created",
      superseded_run_ids,
    };
  }

  /**
   * Per-window coverage for one run, from `topic_cluster_member` alone — no join
   * to the capture tables. `COUNT(*) FILTER (WHERE NOT is_noise)` is exact because
   * noise is a non-null `is_noise` flag, never a NULL `cluster_id` sentinel.
   * Returns null when the run has no members.
   */
  async coverage(run_id: string): Promise<WindowCoverage | null> {
    const row = await this.db.query_first<{
      total: bigint;
      clustered: bigint;
      noise: bigint;
    }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE NOT is_noise) AS clustered,
              count(*) FILTER (WHERE is_noise) AS noise
       FROM ${TOPIC_CLUSTER_MEMBER_TABLE} WHERE run_id = $run_id`,
      { run_id },
    );
    const total = Number(row?.total ?? 0);
    if (total === 0) return null;
    const clustered = Number(row?.clustered ?? 0);
    const noise = Number(row?.noise ?? 0);
    return { run_id, total, clustered, noise, coverage: clustered / total };
  }
}

async function insert_run(tx_run: TxRun, run: RunRecord): Promise<void> {
  await tx_run(
    `INSERT INTO ${TOPIC_RUN_TABLE}
       (id, window_start, window_end, params_hash, params_json,
        embedding_model_id, algo_version, input_count, input_fingerprint,
        cluster_count, noise_count, status, created_at, completed_at)
     VALUES
       ($id, $window_start, $window_end, $params_hash, $params_json,
        $embedding_model_id, $algo_version, $input_count, $input_fingerprint,
        $cluster_count, $noise_count, $status, $created_at, $completed_at)`,
    {
      id: run.id,
      window_start: run.window_start,
      window_end: run.window_end,
      params_hash: run.params_hash,
      params_json: run.params_json,
      embedding_model_id: run.embedding_model_id,
      algo_version: run.algo_version,
      input_count: run.input_count,
      input_fingerprint: run.input_fingerprint,
      cluster_count: run.cluster_count,
      noise_count: run.noise_count,
      status: run.status,
      created_at: run.created_at,
      completed_at: run.completed_at,
    },
  );
}

async function insert_cluster(
  tx_run: TxRun,
  cluster: ClusterRecord,
): Promise<void> {
  await tx_run(
    `INSERT INTO ${TOPIC_CLUSTER_TABLE}
       (id, run_id, local_label, size, exemplar_page_session_id,
        representative_vector, coherence, time_span_start, time_span_end,
        headline_title, scope, keyphrases, display_label, representation_version,
        lifeline_id)
     VALUES
       ($id, $run_id, $local_label, $size, $exemplar_page_session_id,
        $representative_vector, $coherence, $time_span_start, $time_span_end,
        $headline_title, $scope, $keyphrases, $display_label, $representation_version,
        $lifeline_id)`,
    {
      id: cluster.id,
      run_id: cluster.run_id,
      local_label: cluster.local_label,
      size: cluster.size,
      exemplar_page_session_id: cluster.exemplar_page_session_id,
      // FLOAT[] binds element-wise; the input is already float32, so the round-trip
      // is exact (same as page_vector_store.ts).
      representative_vector: listValue(Array.from(cluster.representative_vector)),
      coherence: cluster.coherence,
      time_span_start: cluster.time_span_start,
      time_span_end: cluster.time_span_end,
      headline_title: cluster.headline_title,
      scope: cluster.scope,
      // DuckDB rejects an empty list literal ("item type of ANY"); an empty
      // keyphrases bundle is stored as NULL (the column is nullable).
      keyphrases: cluster.keyphrases.length > 0 ? listValue(cluster.keyphrases) : null,
      display_label: cluster.display_label,
      representation_version: cluster.representation_version,
      lifeline_id: cluster.lifeline_id,
    },
  );
}

async function insert_member(
  tx_run: TxRun,
  member: MemberRecord,
): Promise<void> {
  await tx_run(
    `INSERT INTO ${TOPIC_CLUSTER_MEMBER_TABLE}
       (run_id, page_session_id, cluster_id, is_noise, probability,
        page_loaded_at, is_exemplar)
     VALUES
       ($run_id, $page_session_id, $cluster_id, $is_noise, $probability,
        $page_loaded_at, $is_exemplar)`,
    {
      run_id: member.run_id,
      page_session_id: member.page_session_id,
      cluster_id: member.cluster_id,
      is_noise: member.is_noise,
      probability: member.probability,
      page_loaded_at: member.page_loaded_at,
      is_exemplar: member.is_exemplar,
    },
  );
}
