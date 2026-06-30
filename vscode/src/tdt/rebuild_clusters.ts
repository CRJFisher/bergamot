/**
 * The TDT run orchestrator (TASK-36.9, plan §11 step 9) — the single
 * `rebuild_clusters(deps, spec)` module function both entry surfaces invoke: the
 * manual `bergamot.tdt.rebuildClusters` command and the automatic in-host
 * scheduler. It wires the windowed clustering run end to end while keeping every
 * heavy stage off the extension-host event loop:
 *
 *   1. vectorise — run the batched embed pass so every re-downloadable public
 *      page in scope has a current-model vector (re-download + embed run off the
 *      event loop inside the pass; never-cluster origins are skipped there).
 *   2. read visits — the Stage-1 windowed bulk read over the HTTP/in-process
 *      broker (TDT never opens the single-writer DuckDB file, plan §3).
 *   3. exclude never-cluster origins from the clustering input (AC #8).
 *   4. window — pure calendar windowing + count-guarded subdivision (TASK-36.2).
 *   5. per window: resolve cached vectors, dispatch the dense O(n²) cosine build
 *      + HDBSCAN fit to a forked worker (AC #2), assemble a fully-keyed RunBundle,
 *      and hand it to the single-writer ClusterSink, which persists it
 *      idempotently in one short transaction (AC #3, #6).
 *
 * It is dependency-injected and free of vscode / DuckDB / clustering-tfjs imports
 * so it is unit-testable with fakes: production wires the real embed pass, the
 * in-process reader, the forking worker client, and the DuckDB-backed sink.
 */
import { getDomain } from "tldts";
import { dev_log } from "../dev_log";
import {
  compute_windows,
  assemble_run_bundle,
  compute_params_hash,
  compute_input_fingerprint,
  canonical_timestamp,
  type ResolvedParams,
  type RelationalReader,
  type ClusterSink,
  type WindowConfig,
  type HdbscanConfig,
  type PageVectorConfig,
  type WindowSignal,
  type PageVector,
  type PersistResult,
} from "@bergamot/tdt";
// The tf-pulling compute pipeline is reached by its compiled path: the index
// barrel deliberately omits it (it would pull clustering-tfjs/TensorFlow into
// every consumer), and the repo's classic `moduleResolution: node` resolves a
// deep `/out/` path without needing a package `exports` map.
import type {
  ClusterComputeInput,
  ClusterComputeOutput,
} from "@bergamot/tdt/out/cluster_pipeline";
import type { StoredPageVector } from "./page_vector_store";

/** The time range a run covers; windowing subdivides it into the actual runs. */
export interface WindowSpec {
  /** ISO-8601 UTC, inclusive. */
  range_start: string;
  /** ISO-8601 UTC, exclusive. */
  range_end: string;
}

/**
 * The range both entry surfaces cluster by default: the start of the PREVIOUS
 * calendar month through `now`. That covers the closed previous month (a no-op
 * after its first run, plan §8) plus the still-open current month, so a project
 * spanning the month edge is clustered on both sides and late-arriving visits in
 * the previous month are re-picked up — without re-clustering all of history.
 */
export function default_window_spec(now: Date): WindowSpec {
  const range_start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
  return {
    range_start: range_start.toISOString(),
    range_end: now.toISOString(),
  };
}

export interface RebuildDeps {
  /** Stage-1 windowed visit read (in-process reader fns or the HTTP broker). */
  reader: RelationalReader;
  /** Run the batched embed pass ahead of reading vectors; resolves when every
   *  in-scope public page has a current-model vector. Excludes the given
   *  registrable domains from re-download/embed (AC #8). */
  vectorise: (exclude_origins: string[]) => Promise<void>;
  /** Bulk-read the cached vectors (+ built_at) for the given pages, current model.
   *  Pages with no vector (no-text / auth-walled / not yet embedded) are simply
   *  absent from the result. */
  read_vectors: (page_session_ids: string[]) => Promise<StoredPageVector[]>;
  /** Dispatch one window's cosine build + HDBSCAN fit off the event loop. */
  compute: (input: ClusterComputeInput) => Promise<ClusterComputeOutput>;
  /** The single-writer sink that persists a RunBundle idempotently. */
  sink: ClusterSink;
  /**
   * The `input_fingerprint` of the live (`complete`) run for this window under
   * the current model + params, or null if none. Drives the §6 memoization: when
   * it equals the freshly-computed fingerprint, the window's inputs are unchanged
   * and the run is skipped WITHOUT a re-fit (AC #6) — the heavy worker never
   * spawns. (Matched on window + model + params, not algo_version, which the host
   * cannot resolve without loading TensorFlow; a backend change re-clusters when
   * the window's inputs next change.)
   */
  live_run_fingerprint: (
    window_start: string,
    window_end: string,
    params_hash: string,
  ) => Promise<string | null>;
  /** The user's never-cluster registrable domains (TASK-36.8 control store). */
  list_never_cluster_origins: () => Promise<string[]>;
  /** Wall-clock for the run's forensic `created_at`; injected for determinism. */
  now: () => string;
  /** The cache + clustering key (model + dim + representation-rule version). */
  embedding_model_id: string;
  window_config: WindowConfig;
  hdbscan_config: HdbscanConfig;
  page_vector_config: PageVectorConfig;
}

export type WindowStatus =
  | "clustered"
  | "unchanged" // inputs match the live run — no re-fit, no persist (§6 memoization)
  | "skipped_sparse" // windowing emitted a 'skip' (below min_window_visits)
  | "skipped_no_vectors"; // no in-window page had a cached vector to cluster

export interface WindowOutcome {
  window_start: string;
  window_end: string;
  status: WindowStatus;
  /** Pages actually fed to HDBSCAN (clustered windows only). */
  input_count: number;
  /** The idempotent persist outcome (clustered windows only). */
  persist: PersistResult | null;
}

export interface RebuildReport {
  range_start: string;
  range_end: string;
  /** Visits read before the never-cluster exclusion. */
  total_visits: number;
  /** Registrable domains excluded from the clustering input. */
  excluded_origins: number;
  windows: WindowOutcome[];
}

/**
 * Cluster every window in `spec`, persisting one run per window. Closed windows
 * with unchanged inputs persist as no-ops (plan §8), which is what makes a
 * quiet-day scheduled tick ~free (AC #6).
 */
export async function rebuild_clusters(
  deps: RebuildDeps,
  spec: WindowSpec,
): Promise<RebuildReport> {
  const never_origins = await deps.list_never_cluster_origins();
  const never_set = new Set(never_origins);

  dev_log('cluster_run_started', {
    range_start: spec.range_start,
    range_end: spec.range_end,
  });

  // Vectorise ahead of reading: the embed pass re-downloads + embeds any new
  // public page off the event loop, skipping never-cluster origins so their
  // content is never even re-fetched (constitution §3, AC #8).
  await deps.vectorise(never_origins);

  const all_visits = await deps.reader.list_visits_in_window(
    spec.range_start,
    spec.range_end,
  );

  // Exclude never-cluster origins from the clustering input. A URL that does not
  // parse to a registrable domain is kept (it cannot match a blocked origin).
  const visits = all_visits.filter((v) => {
    const domain = getDomain(v.url);
    return domain === null || !never_set.has(domain);
  });

  const signals = compute_windows(
    visits,
    deps.window_config,
    spec.range_start,
    spec.range_end,
  );

  const windows: WindowOutcome[] = [];
  for (const signal of signals) {
    windows.push(await run_one_window(deps, signal));
  }

  const report: RebuildReport = {
    range_start: spec.range_start,
    range_end: spec.range_end,
    total_visits: all_visits.length,
    excluded_origins: never_set.size,
    windows,
  };
  dev_log('cluster_run_complete', {
    range_start: report.range_start,
    range_end: report.range_end,
    total_visits: report.total_visits,
    excluded_origins: report.excluded_origins,
    windows_total: windows.length,
    windows_clustered: windows.filter((w) => w.status === 'clustered').length,
  });
  return report;
}

async function run_one_window(
  deps: RebuildDeps,
  signal: WindowSignal,
): Promise<WindowOutcome> {
  if (signal.kind === "skip") {
    dev_log('cluster_window_skipped', {
      window_start: signal.start,
      window_end: signal.end,
      reason: 'sparse',
      min_window_visits: deps.window_config.min_window_visits,
    });
    return {
      window_start: signal.start,
      window_end: signal.end,
      status: "skipped_sparse",
      input_count: 0,
      persist: null,
    };
  }

  const stored = await deps.read_vectors(
    signal.visits.map((v) => v.page_session_id),
  );
  const by_id = new Map(stored.map((s) => [s.page_session_id, s]));

  // Keep the §6 stable fetch order (windowing already sorted `signal.visits`),
  // dropping pages with no cached vector — auth-walled / no-text pages the embed
  // pass excluded. visits[i] / vectors[i] / vector_versions[i] stay parallel.
  const kept_visits = signal.visits.filter((v) => by_id.has(v.page_session_id));
  if (kept_visits.length === 0) {
    dev_log('cluster_window_skipped', {
      window_start: signal.start,
      window_end: signal.end,
      reason: 'no_vectors',
    });
    return {
      window_start: signal.start,
      window_end: signal.end,
      status: "skipped_no_vectors",
      input_count: 0,
      persist: null,
    };
  }

  const vectors: PageVector[] = kept_visits.map((v) => ({
    page_session_id: v.page_session_id,
    // low_confidence is not persisted by the vector store and is unused downstream
    // of clustering; the stored vector is the L2-normalized page vector verbatim.
    vector: by_id.get(v.page_session_id)!.vector,
    low_confidence: false,
  }));
  const vector_versions = kept_visits.map(
    (v) => by_id.get(v.page_session_id)!.built_at,
  );

  const params: ResolvedParams = {
    hdbscan: deps.hdbscan_config,
    window: deps.window_config,
    page_vector: deps.page_vector_config,
    matryoshka_dim: null,
  };
  const params_hash = compute_params_hash(params);
  const window_start = canonical_timestamp(signal.start);
  const window_end = canonical_timestamp(signal.end);

  // §6 memoization: if the live run for this window already has these exact
  // inputs, skip the worker entirely — no re-fit, no persist (AC #6). The
  // fingerprint is computed identically to assemble_run_bundle's, so an equal
  // value means the inputs are byte-for-byte unchanged.
  const fingerprint = compute_input_fingerprint(
    kept_visits.map((v, i) => ({
      page_session_id: v.page_session_id,
      embedding_vector_version: vector_versions[i],
    })),
  );
  const existing = await deps.live_run_fingerprint(
    window_start,
    window_end,
    params_hash,
  );
  if (existing === fingerprint) {
    dev_log('cluster_window_skipped', {
      window_start,
      window_end,
      reason: 'unchanged',
      visit_count: kept_visits.length,
    });
    return {
      window_start: signal.start,
      window_end: signal.end,
      status: "unchanged",
      input_count: kept_visits.length,
      persist: null,
    };
  }

  dev_log('cluster_window_started', {
    window_start,
    window_end,
    visit_count: kept_visits.length,
  });

  const output = await deps.compute({
    visits: kept_visits,
    vectors,
    hdbscan: deps.hdbscan_config,
    max_samples: deps.window_config.max_samples,
  });

  const bundle = assemble_run_bundle({
    window_start: signal.start,
    window_end: signal.end,
    embedding_model_id: deps.embedding_model_id,
    algo_version: output.algo_version,
    params,
    created_at: deps.now(),
    visits: kept_visits,
    vector_versions,
    // The worker resolves exemplar identity into represented[].representative_index,
    // so the HdbscanRaw exemplar map is not carried back — assemble reads only
    // labels + probabilities from `raw`.
    raw: {
      labels: output.labels,
      probabilities: output.probabilities,
      exemplar_indices: new Map(),
    },
    represented: output.represented,
    labels: output.cluster_labels,
  });

  const persist = await deps.sink.persist(bundle);
  dev_log('cluster_window_complete', {
    window_start,
    window_end,
    input_count: kept_visits.length,
    cluster_count: output.cluster_labels.length,
    // The DB write outcome — `created`/`replaced` wrote rows to topic_run/
    // topic_cluster/topic_cluster_member; `noop` means an identical complete run
    // already existed and nothing was written.
    persist_outcome: persist.outcome,
    run_id: persist.run_id,
    superseded_runs: persist.superseded_run_ids.length,
  });
  return {
    window_start: signal.start,
    window_end: signal.end,
    status: "clustered",
    input_count: kept_visits.length,
    persist,
  };
}
