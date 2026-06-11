/**
 * Durable visit inbox.
 *
 * A visit is persisted here the moment it is accepted over HTTP, before the
 * server returns 200 to the browser. The browser will not resend, so if the
 * extension restarts before the in-memory queue drains the visit would
 * otherwise be lost. The queue processor removes each entry once the visit has
 * been written to DuckDB, and reloads any leftovers on startup.
 */

import * as fs from "fs";
import * as path from "path";
import { ExtendedPageVisit, is_complete_visit } from "./visit_queue_processor";

export const ensure_inbox = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

export const persist_visit = (dir: string, visit: ExtendedPageVisit): void => {
  fs.writeFileSync(path.join(dir, `${visit.id}.json`), JSON.stringify(visit));
};

export const remove_visit = (dir: string, id: string): void => {
  try {
    fs.unlinkSync(path.join(dir, `${id}.json`));
  } catch {
    // Already removed — nothing to do.
  }
};

export const load_inbox = (dir: string): ExtendedPageVisit[] => {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // Inbox directory does not exist yet — nothing to reload.
    return [];
  }

  // Read each entry independently so a single corrupt file does not discard the
  // rest of the durable inbox.
  return entries.flatMap((f) => {
    const file_path = path.join(dir, f);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file_path, "utf8"));
    } catch {
      console.warn(`Skipping unreadable inbox entry: ${file_path}`);
      return [];
    }
    if (!is_complete_visit(parsed)) {
      // An entry missing required capture fields (e.g. written by an earlier
      // capture model) is a permanent failure: re-queuing it would crash the
      // DB bind and wedge the inbox on every restart, since failures are kept
      // for retry. Delete it so the inbox can drain.
      console.warn(`Dropping malformed inbox entry: ${file_path}`);
      remove_visit(dir, f.replace(/\.json$/, ""));
      return [];
    }
    return [parsed];
  });
};
