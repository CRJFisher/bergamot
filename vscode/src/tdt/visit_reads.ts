/**
 * The Stage-1 windowed visit read (TASK-36.9, plan §6 Stage 1 / §9) — the
 * clustering pipeline's INPUT path, distinct from the cluster surface
 * (`cluster_reads.ts`). It returns one {@link VisitRow} per captured page visit
 * in `[from, to)`, the shape `@bergamot/tdt` windows and clusters.
 *
 * It backs both production reader paths: the in-process {@link RelationalReader}
 * the orchestrator wires when it runs inside the extension, and the
 * `GET /query/visits_in_window` HTTP route the batch CLI would read over (TDT
 * never opens the single-writer DuckDB file directly, plan §3).
 *
 * Only visits WITH a capture are clusterable (no title/url ⇒ no page vector), so
 * the capture join is an INNER join. `site_name` is the `<meta>` value from the
 * most recent re-download that parsed one — display enrichment only (the labeler
 * keys on the url-derived registrable domain), so a NULL is harmless.
 */
import {
  DuckDB,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
} from "../duck_db";
import type { RelationalReader, VisitRow } from "@bergamot/tdt";

/**
 * The bulk-read row cap. Sized to admit a full month's visits with subdivision
 * headroom — personal browsing runs in the low hundreds to low thousands per
 * month (TASK-36.2), comfortably under this — so the cap guards an unbounded read
 * rather than limiting the normal path. It sits ABOVE `max_samples` (the
 * per-subwindow HDBSCAN guard, 4000) on purpose: a heavy month must be READ in
 * full so windowing can subdivide it; capping at `max_samples` would drop the
 * very pages subdivision exists to separate (plan §5). A read that returns
 * exactly the cap is logged as a possible truncation.
 */
export const MAX_VISITS_IN_WINDOW = 5000;

interface VisitQueryRow {
  page_session_id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  page_loaded_at: string;
  tree_id: string;
}

export interface VisitWindowParams {
  /** ISO-8601 UTC, inclusive. */
  from: string;
  /** ISO-8601 UTC, exclusive. */
  to: string;
  /** Row cap; clamped to {@link MAX_VISITS_IN_WINDOW}. */
  limit?: number;
}

/**
 * Read captured visits in `[from, to)`, ordered by `page_loaded_at,
 * page_session_id` (the §6 determinism anchor; windowing re-sorts but the stable
 * read keeps the cap deterministic). `page_loaded_at` is ISO TEXT, so all
 * comparison + ordering CAST to TIMESTAMP (plan §5).
 */
export async function list_visits_in_window(
  db: DuckDB,
  params: VisitWindowParams,
): Promise<VisitRow[]> {
  const requested = params.limit ?? MAX_VISITS_IN_WINDOW;
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_VISITS_IN_WINDOW)
      : MAX_VISITS_IN_WINDOW;

  const rows = await db.query<VisitQueryRow>(
    `SELECT s.id AS page_session_id,
            s.url AS url,
            c.title AS title,
            (SELECT f.site_name FROM ${WEBPAGE_FETCH_TABLE} f
              WHERE f.page_session_id = s.id AND f.site_name IS NOT NULL
              ORDER BY f.fetched_at DESC LIMIT 1) AS site_name,
            s.page_loaded_at AS page_loaded_at,
            s.tree_id AS tree_id
     FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
     JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
     WHERE CAST(s.page_loaded_at AS TIMESTAMP) >= CAST($from AS TIMESTAMP)
       AND CAST(s.page_loaded_at AS TIMESTAMP) <  CAST($to AS TIMESTAMP)
     ORDER BY CAST(s.page_loaded_at AS TIMESTAMP) ASC, s.id ASC
     LIMIT $limit`,
    { from: params.from, to: params.to, limit },
  );

  if (rows.length === limit) {
    console.warn(
      `[tdt] list_visits_in_window hit the ${limit}-row cap for ` +
        `${params.from}/${params.to}; results may be truncated — narrow the range.`,
    );
  }

  return rows.map((r) => ({
    page_session_id: String(r.page_session_id),
    url: String(r.url),
    title: r.title === null ? null : String(r.title),
    site_name: r.site_name === null ? null : String(r.site_name),
    page_loaded_at: String(r.page_loaded_at),
    tree_id: String(r.tree_id),
  }));
}

/** The in-process {@link RelationalReader} the orchestrator wires inside the
 *  extension, as opposed to the HTTP route the batch CLI reads over. */
export function make_relational_reader(db: DuckDB): RelationalReader {
  return {
    list_visits_in_window: (start, end) =>
      list_visits_in_window(db, { from: start, to: end }),
  };
}
