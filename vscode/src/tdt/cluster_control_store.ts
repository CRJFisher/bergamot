/**
 * The cluster CONTROL store (TASK-36.8) — user curation over detected clusters,
 * launch-blocking per constitution §3 ("the control surface is what converts
 * 'surveilled' into 'seen'"). Three controls:
 *
 *   - **suppress** — hide a cluster the user does not want surfaced.
 *   - **rename** — override a cluster's `display_label`.
 *   - **never_cluster_origin** — a registrable domain the user never wants
 *     clustered (e.g. a bank or health portal); also feeds the capture / skip-
 *     re-download list so the origin never re-enters the corpus.
 *
 * This is Bergamot's OWN state, not a PKM write — it lives in the encrypted
 * metadata store, so principle 8 (no agent writes to canonical notes) does not
 * gate it.
 *
 * The stable-identity problem: a cluster's id is `hash(run_id | local_label)`
 * and `run_id` rotates on every recompute, so a control row CANNOT key on the
 * cluster id (it would dangle after the next run). Instead suppress/rename anchor
 * on the cluster's **exemplar page** (`target_page_session_id`, a stable
 * page id) and carry a **content signature** of the label as a secondary matcher
 * for when the exemplar churns. never-cluster-origin keys on the registrable
 * domain and is run-independent by construction. Suppression therefore persists
 * across recomputes, as the constitution requires.
 *
 * Like {@link ClusterStore} / {@link PageVectorStore} this is a thin wrapper over
 * the shared {@link DuckDB} handle the extension already owns — it never opens its
 * own connection.
 */
import { createHash } from "crypto";
import { canonical_json } from "@bergamot/tdt";
import { DuckDB, TOPIC_CLUSTER_CONTROL_TABLE } from "../duck_db";

export type ControlKind = "suppress" | "rename" | "never_cluster_origin";

export interface SuppressControl {
  kind: "suppress";
  target_page_session_id: string;
  content_signature: string;
}
export interface RenameControl {
  kind: "rename";
  target_page_session_id: string;
  content_signature: string;
  display_label_override: string;
}
export interface NeverClusterOriginControl {
  kind: "never_cluster_origin";
  target_origin: string; // a registrable domain (the caller normalizes via tldts)
}
export type ClusterControl =
  | SuppressControl
  | RenameControl
  | NeverClusterOriginControl;

/** One persisted control row, as the curation UI lists them. */
export interface StoredControl {
  id: string;
  kind: ControlKind;
  target_page_session_id: string | null;
  content_signature: string | null;
  target_origin: string | null;
  display_label_override: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The resolved view {@link cluster_reads} applies in-memory. A cluster is
 * suppressed if its exemplar id is in `suppressed_exemplar_ids` OR its label
 * signature is in `suppressed_signatures`; renamed by either match likewise.
 */
export interface ResolvedControls {
  suppressed_exemplar_ids: Set<string>;
  suppressed_signatures: Set<string>;
  rename_by_exemplar_id: Map<string, string>;
  rename_by_signature: Map<string, string>;
}

/** sha256 of a string, hex. */
function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The deterministic primary key. suppress/rename key on the exemplar page id;
 * never-cluster-origin on the domain. A page can be both suppressed and renamed
 * (distinct kinds → distinct ids), but not double-suppressed.
 */
export function control_id(kind: ControlKind, target: string): string {
  return sha256_hex(`${kind}|${target}`);
}

/**
 * The label signature used as the secondary suppress/rename matcher. Canonical
 * over the same fields the labeler produces — lowercased title + scope, and the
 * keyphrases sorted (so member-order changes do not perturb it). It is stable
 * across re-embeds because the deterministic labeler's output is a function of
 * the cluster's own member titles/domains, not of window neighbours.
 */
export function compute_content_signature(parts: {
  headline_title: string | null;
  scope: string | null;
  keyphrases: string[];
}): string {
  return sha256_hex(
    canonical_json({
      t: (parts.headline_title ?? "").trim().toLowerCase(),
      s: (parts.scope ?? "").trim().toLowerCase(),
      k: [...parts.keyphrases].sort(),
    }),
  );
}

function target_of(control: ClusterControl): string {
  return control.kind === "never_cluster_origin"
    ? control.target_origin
    : control.target_page_session_id;
}

export class ClusterControlStore {
  constructor(private readonly db: DuckDB) {}

  /**
   * Insert or refresh one control. Idempotent on the deterministic id: a repeat
   * upsert of the same (kind, target) updates the payload and `updated_at` while
   * preserving the original `created_at`.
   */
  async upsert(control: ClusterControl, now: string): Promise<void> {
    const id = control_id(control.kind, target_of(control));
    await this.db.execute(
      `INSERT INTO ${TOPIC_CLUSTER_CONTROL_TABLE}
         (id, kind, target_page_session_id, content_signature, target_origin,
          display_label_override, created_at, updated_at)
       VALUES
         ($id, $kind, $target_page_session_id, $content_signature, $target_origin,
          $display_label_override, $now, $now)
       ON CONFLICT (id) DO UPDATE SET
         content_signature = excluded.content_signature,
         target_origin = excluded.target_origin,
         display_label_override = excluded.display_label_override,
         updated_at = excluded.updated_at`,
      {
        id,
        kind: control.kind,
        target_page_session_id:
          control.kind === "never_cluster_origin"
            ? null
            : control.target_page_session_id,
        content_signature:
          control.kind === "never_cluster_origin"
            ? null
            : control.content_signature,
        target_origin:
          control.kind === "never_cluster_origin"
            ? control.target_origin
            : null,
        display_label_override:
          control.kind === "rename" ? control.display_label_override : null,
        now,
      },
    );
  }

  /** All controls (optionally of one kind), newest-first for the curation UI. */
  async list(kind?: ControlKind): Promise<StoredControl[]> {
    const where = kind ? "WHERE kind = $kind" : "";
    const rows = await this.db.query<StoredControl>(
      `SELECT id, kind, target_page_session_id, content_signature, target_origin,
              display_label_override, created_at, updated_at
       FROM ${TOPIC_CLUSTER_CONTROL_TABLE} ${where}
       ORDER BY updated_at DESC, id`,
      kind ? { kind } : {},
    );
    return rows;
  }

  /** Remove one control (un-suppress / un-rename / un-block), by kind + target. */
  async delete(
    kind: ControlKind,
    target: { page_session_id?: string; origin?: string },
  ): Promise<void> {
    const key =
      kind === "never_cluster_origin"
        ? (target.origin ?? "")
        : (target.page_session_id ?? "");
    await this.db.execute(
      `DELETE FROM ${TOPIC_CLUSTER_CONTROL_TABLE} WHERE id = $id`,
      { id: control_id(kind, key) },
    );
  }

  /** The maps {@link cluster_reads} applies to hide/rename clusters in-memory. */
  async resolve_controls(): Promise<ResolvedControls> {
    const rows = await this.list();
    const resolved: ResolvedControls = {
      suppressed_exemplar_ids: new Set(),
      suppressed_signatures: new Set(),
      rename_by_exemplar_id: new Map(),
      rename_by_signature: new Map(),
    };
    for (const row of rows) {
      if (row.kind === "suppress") {
        if (row.target_page_session_id)
          resolved.suppressed_exemplar_ids.add(row.target_page_session_id);
        if (row.content_signature)
          resolved.suppressed_signatures.add(row.content_signature);
      } else if (row.kind === "rename" && row.display_label_override) {
        if (row.target_page_session_id)
          resolved.rename_by_exemplar_id.set(
            row.target_page_session_id,
            row.display_label_override,
          );
        if (row.content_signature)
          resolved.rename_by_signature.set(
            row.content_signature,
            row.display_label_override,
          );
      }
    }
    return resolved;
  }

  /**
   * The registrable domains the user has blocked. Single source of truth for the
   * skip-re-download filter and the clustering-input filter, so the two cannot
   * drift.
   */
  async list_never_cluster_origins(): Promise<string[]> {
    const rows = await this.db.query<{ target_origin: string }>(
      `SELECT target_origin FROM ${TOPIC_CLUSTER_CONTROL_TABLE}
       WHERE kind = 'never_cluster_origin' AND target_origin IS NOT NULL
       ORDER BY target_origin`,
    );
    return rows.map((r) => String(r.target_origin));
  }
}
