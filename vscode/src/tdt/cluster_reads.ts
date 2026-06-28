/**
 * The cluster READ primitive (TASK-36.8) — the single, host-agnostic read API
 * over the cluster + 36.5 label-bundle tables. Four pure `(db, params) → JSON`
 * functions; the ONLY surface-facing code that JOINs `topic_run` × `topic_cluster`
 * × `topic_cluster_member` (plus `webpage_*` for page url/title/time). Returns
 * plain JSON-serializable objects — no MCP, HTTP, or VS Code types — so every
 * surface (the note-stub writer in-process, the skill over the relay, a future
 * webview) consumes one stable JSON shape rather than the table layout.
 *
 * Two contracts the data layer pins:
 *   - **Live run only.** Every query filters to `topic_run.status = 'complete'`.
 *     Superseded / running / failed runs retained in history are excluded, so a
 *     page or window never double-surfaces and the user never reads retained
 *     history as instability.
 *   - **Controls applied here.** User curation (suppress / rename, TASK-36.8
 *     control surface) is applied in-memory against the page/origin-keyed control
 *     store — deliberately NOT SQL-joined, because controls key on a stable page
 *     identity, not the per-run cluster id. Applying it here keeps `cluster_reads`
 *     the single place controls take effect, so no consumer ever sees an
 *     un-curated cluster.
 *
 * `scope` is surfaced VERBATIM as the 36.5 labeler stored it (a display-ready
 * string like "nextjs.org, github.com +3 sites"); it is not re-parsed into a
 * structured shape. `representative_vector` is never selected — it is an internal
 * tracking input with no surface consumer.
 */
import { DuckDBListValue } from "@duckdb/node-api";
import {
  DuckDB,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
} from "../duck_db";
import {
  ClusterControlStore,
  compute_content_signature,
  type ResolvedControls,
} from "./cluster_control_store";

/** The stable curation anchor for a live cluster — used by the control route to
 *  translate an ephemeral cluster id into a recompute-stable suppress/rename key. */
export interface ClusterAnchor {
  exemplar_page_session_id: string;
  content_signature: string;
}

/** Self-clamp ceiling — the read layer is callable outside HTTP, so it clamps
 *  even though the server route also clamps (mirrors server_manager's const). */
export const MAX_QUERY_LIMIT = 100;

export interface TimeSpan {
  start: string;
  end: string;
}

export interface ClusterSummary {
  id: string;
  run_id: string;
  display_label: string | null;
  /**
   * The user's rename override, or null when the cluster carries the labeler's
   * deterministic label. A rename overwrites `display_label` (the read-surface
   * label every consumer shows) AND is mirrored here, so a downstream renderer
   * can distinguish a user override from the labeler default — the note-stub
   * heading honours the rename while its filename/lineage stays anchored on the
   * rename-independent original label.
   */
  renamed_label: string | null;
  headline_title: string | null;
  scope: string | null;
  keyphrases: string[];
  size: number;
  coherence: number | null;
  time_span: TimeSpan;
  representation_version: string | null;
}

export interface PageRef {
  page_session_id: string;
  url: string | null;
  title: string | null;
  page_loaded_at: string | null;
}

export interface ClusterMember extends PageRef {
  probability: number;
  is_exemplar: boolean;
}

export interface ClusterDetail {
  cluster: ClusterSummary;
  exemplar_page: PageRef | null;
  members: ClusterMember[];
}

export type PageStatus = "clustered" | "noise" | "unseen";

export interface PageClusters {
  clusters: ClusterSummary[];
  page_status: PageStatus;
}

export interface WindowCoverage {
  window: TimeSpan;
  input_count: number;
  cluster_count: number;
  noise_count: number;
  coverage: number;
}

/** The cluster columns every summary query selects — includes the exemplar id,
 *  used for control matching but dropped from the returned `ClusterSummary`. */
const CLUSTER_COLUMNS = `c.id, c.run_id, c.display_label, c.headline_title,
  c.scope, c.keyphrases, c.size, c.coherence, c.time_span_start, c.time_span_end,
  c.representation_version, c.exemplar_page_session_id`;

interface ClusterRow {
  id: string;
  run_id: string;
  display_label: string | null;
  headline_title: string | null;
  scope: string | null;
  keyphrases: unknown;
  size: bigint | number;
  coherence: number | null;
  time_span_start: string;
  time_span_end: string;
  representation_version: string | null;
  exemplar_page_session_id: string;
}

function to_string_array(value: unknown): string[] {
  return value instanceof DuckDBListValue ? value.items.map(String) : [];
}

function clamp_limit(limit: number | undefined): number {
  const requested = Number(limit ?? MAX_QUERY_LIMIT);
  return Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : MAX_QUERY_LIMIT,
    MAX_QUERY_LIMIT,
  );
}

function row_to_summary(row: ClusterRow): ClusterSummary {
  return {
    id: row.id,
    run_id: row.run_id,
    display_label: row.display_label,
    renamed_label: null,
    headline_title: row.headline_title,
    scope: row.scope,
    keyphrases: to_string_array(row.keyphrases),
    size: Number(row.size),
    coherence: row.coherence === null ? null : Number(row.coherence),
    time_span: { start: row.time_span_start, end: row.time_span_end },
    representation_version: row.representation_version,
  };
}

/** True when this cluster is suppressed by exemplar id or label signature. */
function is_suppressed(row: ClusterRow, controls: ResolvedControls): boolean {
  if (controls.suppressed_exemplar_ids.has(row.exemplar_page_session_id))
    return true;
  if (controls.suppressed_signatures.size === 0) return false;
  return controls.suppressed_signatures.has(signature_of(row));
}

function signature_of(row: ClusterRow): string {
  return compute_content_signature({
    headline_title: row.headline_title,
    scope: row.scope,
    keyphrases: to_string_array(row.keyphrases),
  });
}

/** Apply a rename override (by exemplar id, else by signature) if any. */
function apply_rename(
  summary: ClusterSummary,
  row: ClusterRow,
  controls: ResolvedControls,
): ClusterSummary {
  const by_id = controls.rename_by_exemplar_id.get(row.exemplar_page_session_id);
  if (by_id !== undefined)
    return { ...summary, display_label: by_id, renamed_label: by_id };
  if (controls.rename_by_signature.size > 0) {
    const by_sig = controls.rename_by_signature.get(signature_of(row));
    if (by_sig !== undefined)
      return { ...summary, display_label: by_sig, renamed_label: by_sig };
  }
  return summary;
}

/** Drop suppressed clusters and apply rename overrides to the survivors. */
function curate(rows: ClusterRow[], controls: ResolvedControls): ClusterSummary[] {
  const out: ClusterSummary[] = [];
  for (const row of rows) {
    if (is_suppressed(row, controls)) continue;
    out.push(apply_rename(row_to_summary(row), row, controls));
  }
  return out;
}

/**
 * Clusters whose time span overlaps `[from, to)`, in the live run, newest-first
 * (by `time_span_start`), clamped to {@link MAX_QUERY_LIMIT}. Suppressed clusters
 * are dropped and renames applied before the limit is honoured on the survivors.
 */
export async function list_clusters_in_range(
  db: DuckDB,
  args: { from: string; to: string; limit?: number },
): Promise<ClusterSummary[]> {
  const limit = clamp_limit(args.limit);
  const rows = await db.query<ClusterRow>(
    `SELECT ${CLUSTER_COLUMNS}
     FROM ${TOPIC_CLUSTER_TABLE} c
     JOIN ${TOPIC_RUN_TABLE} r ON r.id = c.run_id
     WHERE r.status = 'complete'
       -- time_span_* are INCLUSIVE member-time bounds, so a cluster ending exactly
       -- at $from still overlaps: time_span_end >= $from (cf. window_coverage,
       -- whose run window_end is half-open → window_end > $from).
       AND c.time_span_start < $to
       AND c.time_span_end >= $from
     ORDER BY c.time_span_start DESC, c.id`,
    { from: args.from, to: args.to },
  );
  const controls = await new ClusterControlStore(db).resolve_controls();
  return curate(rows, controls).slice(0, limit);
}

/**
 * One cluster with its exemplar page and members (ranked by membership
 * probability, capped). Returns `null` when the id is unknown, its run is not the
 * live run, or the cluster is suppressed.
 */
export async function get_cluster(
  db: DuckDB,
  args: { id: string },
): Promise<ClusterDetail | null> {
  const row = await db.query_first<ClusterRow>(
    `SELECT ${CLUSTER_COLUMNS}
     FROM ${TOPIC_CLUSTER_TABLE} c
     JOIN ${TOPIC_RUN_TABLE} r ON r.id = c.run_id
     WHERE c.id = $id AND r.status = 'complete'`,
    { id: args.id },
  );
  if (!row) return null;

  const controls = await new ClusterControlStore(db).resolve_controls();
  if (is_suppressed(row, controls)) return null;
  const cluster = apply_rename(row_to_summary(row), row, controls);

  const member_rows = await db.query<{
    page_session_id: string;
    url: string | null;
    title: string | null;
    page_loaded_at: string | null;
    probability: number;
    is_exemplar: boolean;
  }>(
    `SELECT m.page_session_id, s.url, cap.title, s.page_loaded_at,
            m.probability, m.is_exemplar
     FROM ${TOPIC_CLUSTER_MEMBER_TABLE} m
     LEFT JOIN ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s ON s.id = m.page_session_id
     LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} cap ON cap.page_session_id = m.page_session_id
     WHERE m.cluster_id = $id
     ORDER BY m.probability DESC, m.page_session_id
     LIMIT $limit`,
    { id: args.id, limit: MAX_QUERY_LIMIT },
  );
  const members: ClusterMember[] = member_rows.map((m) => ({
    page_session_id: m.page_session_id,
    url: m.url,
    title: m.title,
    page_loaded_at: m.page_loaded_at,
    probability: Number(m.probability),
    is_exemplar: Boolean(m.is_exemplar),
  }));

  // Resolve the exemplar page directly so it is present even if it fell beyond
  // the member cap.
  const exemplar_page = await page_ref(db, row.exemplar_page_session_id);
  return { cluster, exemplar_page, members };
}

/**
 * Resolve a live cluster id to its stable curation anchor (exemplar page +
 * label signature). Returns `null` when the id is unknown or its run is not the
 * live run (the curation UI raced a recompute — the caller asks the user to
 * refresh). The control row keys on these stable parts, never the cluster id.
 */
export async function get_cluster_anchor(
  db: DuckDB,
  id: string,
): Promise<ClusterAnchor | null> {
  const row = await db.query_first<{
    exemplar_page_session_id: string;
    headline_title: string | null;
    scope: string | null;
    keyphrases: unknown;
  }>(
    `SELECT c.exemplar_page_session_id, c.headline_title, c.scope, c.keyphrases
     FROM ${TOPIC_CLUSTER_TABLE} c
     JOIN ${TOPIC_RUN_TABLE} r ON r.id = c.run_id
     WHERE c.id = $id AND r.status = 'complete'`,
    { id },
  );
  if (!row) return null;
  return {
    exemplar_page_session_id: row.exemplar_page_session_id,
    content_signature: compute_content_signature({
      headline_title: row.headline_title,
      scope: row.scope,
      keyphrases: to_string_array(row.keyphrases),
    }),
  };
}

async function page_ref(
  db: DuckDB,
  page_session_id: string,
): Promise<PageRef | null> {
  const row = await db.query_first<{
    url: string | null;
    title: string | null;
    page_loaded_at: string | null;
  }>(
    `SELECT s.url, cap.title, s.page_loaded_at
     FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
     LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} cap ON cap.page_session_id = s.id
     WHERE s.id = $id`,
    { id: page_session_id },
  );
  if (!row) return null;
  return {
    page_session_id,
    url: row.url,
    title: row.title,
    page_loaded_at: row.page_loaded_at,
  };
}

/**
 * The live-run clusters a page belongs to, plus a three-way `page_status`:
 *   - "clustered" — the page is a non-noise member of ≥1 live cluster.
 *   - "noise"     — the page was processed in a live run but landed as HDBSCAN
 *                   noise (an honest "this was a one-off in its window").
 *   - "unseen"    — the page is in no live run at all.
 * `page_status` reflects the raw data; the `clusters` array reflects only
 * non-suppressed clusters, so a clustered-but-suppressed page returns
 * `page_status: "clustered"` with an empty `clusters` array.
 */
export async function list_clusters_for_page(
  db: DuckDB,
  args: { page_session_id: string },
): Promise<PageClusters> {
  const rows = await db.query<ClusterRow>(
    `SELECT ${CLUSTER_COLUMNS}
     FROM ${TOPIC_CLUSTER_MEMBER_TABLE} m
     JOIN ${TOPIC_RUN_TABLE} r ON r.id = m.run_id
     JOIN ${TOPIC_CLUSTER_TABLE} c ON c.id = m.cluster_id
     WHERE m.page_session_id = $page_session_id
       AND r.status = 'complete'
       AND m.is_noise = FALSE
     ORDER BY c.time_span_start DESC, c.id`,
    { page_session_id: args.page_session_id },
  );

  if (rows.length > 0) {
    const controls = await new ClusterControlStore(db).resolve_controls();
    return { clusters: curate(rows, controls), page_status: "clustered" };
  }

  // No live-run cluster membership — distinguish processed-as-noise from unseen.
  const probe = await db.query_first<{ live_rows: bigint | number }>(
    `SELECT count(*) AS live_rows
     FROM ${TOPIC_CLUSTER_MEMBER_TABLE} m
     JOIN ${TOPIC_RUN_TABLE} r ON r.id = m.run_id
     WHERE m.page_session_id = $page_session_id AND r.status = 'complete'`,
    { page_session_id: args.page_session_id },
  );
  const page_status: PageStatus =
    Number(probe?.live_rows ?? 0) > 0 ? "noise" : "unseen";
  return { clusters: [], page_status };
}

/**
 * Per-window coverage over the live runs overlapping `[from, to)`:
 * `coverage = (input_count − noise_count) / input_count`, derivable from
 * `topic_cluster_member` alone. Independent of controls — suppressing a cluster
 * does not change that its pages were clustered.
 */
export async function window_coverage(
  db: DuckDB,
  args: { from: string; to: string },
): Promise<WindowCoverage[]> {
  const rows = await db.query<{
    window_start: string;
    window_end: string;
    input_count: bigint | number;
    cluster_count: bigint | number;
    noise_count: bigint | number;
  }>(
    `SELECT r.window_start, r.window_end,
            count(m.page_session_id) AS input_count,
            count(m.page_session_id) FILTER (WHERE NOT m.is_noise) AS cluster_count,
            count(m.page_session_id) FILTER (WHERE m.is_noise) AS noise_count
     FROM ${TOPIC_RUN_TABLE} r
     LEFT JOIN ${TOPIC_CLUSTER_MEMBER_TABLE} m ON m.run_id = r.id
     WHERE r.status = 'complete'
       -- run window bounds are HALF-OPEN [start, end), so end > $from (cf.
       -- list_clusters_in_range, whose cluster time_span_end is inclusive → >= $from).
       AND r.window_start < $to
       AND r.window_end > $from
     GROUP BY r.window_start, r.window_end
     ORDER BY r.window_start DESC`,
    { from: args.from, to: args.to },
  );
  return rows.map((r) => {
    const input_count = Number(r.input_count);
    const noise_count = Number(r.noise_count);
    return {
      window: { start: r.window_start, end: r.window_end },
      input_count,
      cluster_count: Number(r.cluster_count),
      noise_count,
      coverage: input_count > 0 ? (input_count - noise_count) / input_count : 0,
    };
  });
}
