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
import { ExtendedPageVisit } from "./visit_queue_processor";

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
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map(
        (f) =>
          JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as ExtendedPageVisit
      );
  } catch {
    return [];
  }
};
