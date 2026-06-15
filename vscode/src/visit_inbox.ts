/**
 * Durable visit inbox — encrypted at rest.
 *
 * A visit is persisted here the moment it is accepted over HTTP, before the
 * server returns 200 to the browser. The browser will not resend, so if the
 * extension restarts before the in-memory queue drains the visit would
 * otherwise be lost. The queue processor removes each entry once the visit has
 * been written to DuckDB, and reloads any leftovers on startup.
 *
 * The inbox lives as a table inside the encrypted DuckDB metadata store, so
 * visits-in-flight are never plaintext on disk.
 */

import { DuckDB, VISIT_INBOX_TABLE } from "./duck_db";
import { ExtendedPageVisit, is_complete_visit } from "./visit_types";

export const persist_visit = async (
  db: DuckDB,
  visit: ExtendedPageVisit
): Promise<void> => {
  await db.execute(
    `INSERT INTO ${VISIT_INBOX_TABLE} (id, url, page_loaded_at, visit_json)
     VALUES ($id, $url, $page_loaded_at, $visit_json)
     ON CONFLICT (id) DO NOTHING`,
    {
      id: visit.id,
      url: visit.url,
      page_loaded_at: visit.page_loaded_at ?? null,
      visit_json: JSON.stringify(visit),
    }
  );
};

export const remove_visit = async (
  db: DuckDB,
  id: string
): Promise<void> => {
  await db.execute(
    `DELETE FROM ${VISIT_INBOX_TABLE} WHERE id = $id`,
    { id }
  );
};

export const load_inbox = async (db: DuckDB): Promise<ExtendedPageVisit[]> => {
  const rows = await db.query<{ id: string; visit_json: string }>(
    `SELECT id, visit_json FROM ${VISIT_INBOX_TABLE}`
  );
  const valid: ExtendedPageVisit[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.visit_json);
    } catch {
      console.warn(`Skipping unreadable inbox entry: ${row.id}`);
      continue;
    }
    if (!is_complete_visit(parsed)) {
      // An entry written by an earlier capture model is missing required fields.
      // Re-queuing it would crash the DB bind; delete it so the inbox can drain.
      console.warn(`Dropping malformed inbox entry: ${row.id}`);
      await remove_visit(db, row.id);
      continue;
    }
    valid.push(parsed);
  }
  return valid;
};
