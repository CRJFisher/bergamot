import { DuckDBValue } from "@duckdb/node-api";
import { PageActivitySession } from "../duck_db_models";
import { DuckDB } from "./connection";
import {
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_TREES_TABLE,
} from "./table_names";

/**
 * Inserts or updates a page activity session.
 *
 * @returns `tree_changed` — true for a newly created row, or when an existing
 *   row is moved to a different tree.
 */
export async function insert_page_activity_session(
  db: DuckDB,
  session: PageActivitySession
): Promise<{ tree_changed: boolean }> {
  const existing_session = await db.connection.runAndReadAll(
    `SELECT tree_id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} WHERE id = $id`,
    { id: session.id }
  );

  const existing_rows = existing_session.getRowObjects();
  const was_new_session = existing_rows.length === 0;
  const tree_changed =
    was_new_session || existing_rows[0].tree_id !== session.tree_id;

  const params: Record<string, DuckDBValue> = {
    id: session.id,
    url: session.url,
    referrer: session.referrer,
    referrer_page_session_id: session.referrer_page_session_id ?? null,
    page_loaded_at: session.page_loaded_at,
    tree_id: session.tree_id,
  };

  if (was_new_session) {
    await db.execute(
      `INSERT INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
        (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
       VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
      params
    );
  } else {
    await db.execute(
      `UPDATE ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       SET url = $url,
           referrer = $referrer,
           referrer_page_session_id = $referrer_page_session_id,
           page_loaded_at = $page_loaded_at,
           tree_id = $tree_id
       WHERE id = $id`,
      params
    );
  }

  return { tree_changed };
}

/** Inserts a new navigation tree, or advances its latest_activity_time. */
export async function insert_webpage_tree(
  db: DuckDB,
  tree_id: string,
  first_load_time: string,
  latest_activity_time: string
): Promise<void> {
  const existing = await db.query_first(
    `SELECT id FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
    { id: tree_id }
  );

  if (existing) {
    await db.execute(
      `UPDATE ${WEBPAGE_TREES_TABLE}
       SET latest_activity_time = $latest_activity_time
       WHERE id = $id AND latest_activity_time < $latest_activity_time`,
      { id: tree_id, latest_activity_time }
    );
  } else {
    await db.execute(
      `INSERT INTO ${WEBPAGE_TREES_TABLE}
        (id, first_load_time, latest_activity_time)
       VALUES ($id, $first_load_time, $latest_activity_time)`,
      { id: tree_id, first_load_time, latest_activity_time }
    );
  }
}

export async function update_webpage_tree_activity_time(
  db: DuckDB,
  tree_id: string,
  latest_activity_time: string
): Promise<void> {
  const existing = await db.query_first<{
    id: string;
    latest_activity_time: string;
  }>(
    `SELECT id, latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
    { id: tree_id }
  );

  if (!existing) {
    console.warn(`Tree ${tree_id} does not exist, skipping update`);
    return;
  }

  if (existing.latest_activity_time >= latest_activity_time) return;

  try {
    await db.execute(
      `UPDATE ${WEBPAGE_TREES_TABLE}
       SET latest_activity_time = $latest_activity_time
       WHERE id = $id`,
      { id: tree_id, latest_activity_time }
    );
  } catch (error) {
    // DuckDB raises a foreign-key constraint error when UPDATEing a table that
    // is referenced by a foreign key, even for a non-key column. This is a known
    // DuckDB limitation, not a real integrity problem (only latest_activity_time
    // changes), so the update is skipped rather than aborting the visit.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("foreign key constraint")) {
      console.warn(
        "Skipping tree update due to DuckDB foreign key handling:",
        message
      );
      return;
    }
    throw error;
  }
}

