import { DuckDBValue } from "@duckdb/node-api";
import {
  PageCapture,
  PageActivitySessionWithMeta,
  PageActivitySessionWithMetaSchema,
} from "../page_capture_models";
import {
  PageActivitySession,
  PageActivitySessionSchema,
} from "../duck_db_models";
import { DuckDB } from "./connection";
import {
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_TREES_TABLE,
} from "./table_names";

/**
 * Capture columns are aliased cap_* so they survive `s.*` selection without
 * colliding with session columns; row_to_page_activity_session_with_meta keys
 * off these aliases.
 */
const CAPTURE_SELECT = [
  "c.title as cap_title",
  "c.content_type as cap_content_type",
  "c.captured_at as cap_captured_at",
].join(",\n         ");

function row_to_page_activity_session(
  row: Record<string, DuckDBValue>
): PageActivitySession {
  return PageActivitySessionSchema.parse({
    id: row.id.toString(),
    url: row.url.toString(),
    referrer: row.referrer ? row.referrer.toString() : null,
    referrer_page_session_id: row.referrer_page_session_id
      ? row.referrer_page_session_id.toString()
      : null,
    page_loaded_at: row.page_loaded_at.toString(),
    tree_id: row.tree_id.toString(),
  });
}

function row_to_page_activity_session_with_meta(
  row: Record<string, DuckDBValue>
): PageActivitySessionWithMeta {
  const base_session = row_to_page_activity_session(row);

  // A capture row is present iff its (NOT NULL) title joined through. When
  // present, the other NOT NULL columns (content_type / captured_at) are
  // guaranteed non-null, so they are read directly.
  const capture_exists =
    row.cap_title !== null && row.cap_title !== undefined;
  const capture: PageCapture | undefined = capture_exists
    ? {
        page_session_id: base_session.id,
        url: base_session.url,
        title: row.cap_title.toString(),
        content_type: row.cap_content_type.toString(),
        captured_at: row.cap_captured_at.toString(),
      }
    : undefined;

  return PageActivitySessionWithMetaSchema.parse({
    ...base_session,
    capture,
  });
}

/**
 * Finds a navigation tree containing the specified URL using fuzzy matching to
 * handle referrer policy truncation (cross-origin referrers are truncated to
 * origin only). Returns the closest matching session by timestamp.
 */
export async function find_tree_containing_url(
  db: DuckDB,
  referrer_url: string,
  new_page_visited_at: string
): Promise<PageActivitySession | null> {
  const result = await db.connection.runAndReadAll(
    `SELECT *
     FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
     WHERE url LIKE $referrer_pattern
     ORDER BY ABS(EPOCH(CAST($new_page_timestamp AS TIMESTAMP)) - EPOCH(CAST(page_loaded_at AS TIMESTAMP))) ASC
     LIMIT 1`,
    {
      referrer_pattern: `${referrer_url}%`,
      new_page_timestamp: new_page_visited_at,
    }
  );
  const rows = result.getRowObjects();
  return rows.length > 0 ? row_to_page_activity_session(rows[0]) : null;
}

export async function get_page_sessions_with_tree_id(
  db: DuckDB,
  tree_id: string
): Promise<PageActivitySessionWithMeta[]> {
  const result = await db.connection.runAndReadAll(
    `SELECT
       s.*,
       ${CAPTURE_SELECT}
     FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
     LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
     WHERE s.tree_id = $tree_id`,
    { tree_id }
  );
  return result.getRowObjects().map(row_to_page_activity_session_with_meta);
}

/**
 * table_id_to_exclude omits the current active tree so callers surface only
 * other recent trees. Members are grouped by tree id in the returned record.
 */
export async function get_last_modified_trees_with_members(
  db: DuckDB,
  table_id_to_exclude: string,
  limit = 5
): Promise<Record<string, PageActivitySessionWithMeta[]>> {
  const result = await db.connection.runAndReadAll(
    `SELECT
       s.*,
       ${CAPTURE_SELECT}
     FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
     LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
     WHERE s.tree_id IN (
       SELECT id
       FROM ${WEBPAGE_TREES_TABLE}
       WHERE id != $table_id_to_exclude
       ORDER BY latest_activity_time DESC
       LIMIT $limit
     )
     ORDER BY s.tree_id, s.page_loaded_at ASC`,
    { limit, table_id_to_exclude }
  );

  const all_tree_members = result
    .getRowObjects()
    .map(row_to_page_activity_session_with_meta);

  return all_tree_members.reduce(
    (acc, member) => {
      const tree_id = member.tree_id;
      if (!acc[tree_id]) {
        acc[tree_id] = [];
      }
      acc[tree_id].push(member);
      return acc;
    },
    {} as Record<string, PageActivitySessionWithMeta[]>
  );
}
