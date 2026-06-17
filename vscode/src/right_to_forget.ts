/**
 * The cascading right-to-forget primitive (constitution principle 4).
 * Forgetting — by URL, by origin, or by time-range — deletes the metadata
 * rows AND every artifact that encodes the forgotten pages: the fetch log
 * (matched by stored URL and by post-redirect final URL), the encrypted
 * content cache, the visit_inbox table rows buffered under the metadata store,
 * the plaintext dev-replay files buffered under the storage base, the
 * plaintext dev-log files (`dev-log.jsonl` and its rotation, deleted
 * wholesale), and the in-memory visit-outcome ring. Forgetting is deletion, not hiding: surviving
 * visits' referrer fields are scrubbed and navigation trees left empty are
 * removed.
 *
 * THIS MODULE IS THE CASCADE'S SINGLE HOME: every derived store joins it as
 * it lands. Today that is the metadata tables (including the visit_inbox
 * buffer, task-39.8), the encrypted content cache (task-39.3), the plaintext
 * dev-replay ring, and the plaintext dev-log files (dev-log.jsonl{,.1},
 * deleted wholesale); TDT cluster tables (task-36) and RAG vectors (task-31)
 * are added here when those stores exist (both tasks carry an acceptance
 * criterion pointing back at this module).
 *
 * Ordering and atomicity, honestly: the metadata-side deletes run in one
 * transaction on a dedicated connection (the empty-tree sweep necessarily
 * follows it — DuckDB cannot delete a foreign-key parent in the same
 * transaction as its children). Cross-store atomicity over multiple files
 * is not possible, so the cascade deletes derived/plaintext artifacts first
 * and is idempotent — a failure between stores can only leave metadata
 * without content (the safe direction), and re-running the same forget
 * completes it (the tree sweep runs even when nothing resolves). A visit
 * that arrives concurrently with the forget and references a forgotten page
 * can land after the referrer scrub; the command layer purges the live
 * queue first to close most of that window.
 *
 * Two more bounds, stated plainly: deleted rows' ciphertext can persist in
 * freed blocks of each encrypted store file until DuckDB reuses them — it
 * is unreadable without the live keys, and emptying or re-keying a store
 * destroys it outright. And a forget can over-delete derived artifacts:
 * fetch-log rows and cached content are matched by URL, so a surviving
 * visit that shares a URL with a forgotten one loses those (re-creatable)
 * artifacts while its own metadata rows survive — the privacy-safe
 * direction. A URL forget deliberately does not scrub origin-truncated
 * referrers on survivors (they may attest to other, unforgotten pages on
 * that origin); an origin forget does.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DuckDB,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  WEBPAGE_TREES_TABLE,
  VISIT_INBOX_TABLE,
} from "./duck_db";
import { ContentCache } from "./redownload/content_cache";
import { purge_outcomes, DEV_LOG_FILENAME } from "./dev_log";

/** What to forget. Time bounds are ISO-8601 strings, inclusive. */
export type ForgetSelector =
  | { kind: "url"; url: string }
  | { kind: "origin"; origin: string }
  | { kind: "time_range"; from: string; to: string };

/** What one forget removed, per store. */
export interface ForgetReport {
  /** Page sessions resolved by the selector (capture/activity/fetch rows). */
  page_session_ids: number;
  /** Distinct URLs the forget swept (resolved plus the selector's own). */
  urls: number;
  /** Whether the content-cache cascade ran (false when no cache exists). */
  content_cache_swept: boolean;
  /** Selector-matched plaintext dev-replay files (captures/) removed. */
  files_removed: number;
  /** Dev-log plaintext files (dev-log.jsonl and .1) deleted wholesale. 0, 1, or 2. */
  dev_log_files_removed: number;
}

/** The resolved blast radius of a selector: session ids and their URLs. */
interface ForgetTargets {
  page_session_ids: string[];
  urls: string[];
}

/** True when the URL parses and its origin equals the given origin. */
function has_origin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * True when a visit at `url`/`at` falls under the selector. Time bounds
 * compare as epochs (an unparseable or missing timestamp matches no time
 * window — such a row is forgettable by url/origin only, deliberately).
 */
export function selector_matches(
  selector: ForgetSelector,
  url: string,
  at: string | null
): boolean {
  if (selector.kind === "url") {
    return url === selector.url;
  }
  if (selector.kind === "origin") {
    return has_origin(url, selector.origin);
  }
  const t = at === null ? NaN : Date.parse(at);
  return t >= Date.parse(selector.from) && t <= Date.parse(selector.to);
}

/** Builds `$p0, $p1, ...` placeholders plus the matching params object. */
function in_list(
  values: string[],
  prefix: string
): { placeholders: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const placeholders = values
    .map((value, i) => {
      params[`${prefix}${i}`] = value;
      return `$${prefix}${i}`;
    })
    .join(", ");
  return { placeholders, params };
}

/**
 * Resolves the selector to the page sessions (and URLs) it forgets. All
 * three URL-bearing tables are consulted: `webpage_capture` and
 * `webpage_activity_sessions` (a session can exist in either before the
 * other), and `webpage_fetch` — whose `url` and post-redirect `final_url`
 * can carry a forgotten URL no capture row holds. The full scan is
 * deliberate: origin equality requires URL parsing (a prefix LIKE misses
 * origin normalization), and forget is a rare, local-scale operation.
 *
 * For a URL selector the selector's own URL is always part of the sweep,
 * even when no row resolves — so orphaned cache entries and fetch rows for
 * that URL are deleted regardless.
 */
async function resolve_targets(
  metadata_db: DuckDB,
  selector: ForgetSelector
): Promise<ForgetTargets> {
  const ids = new Set<string>();
  const urls = new Set<string>();

  const visit_rows = await metadata_db.query<{
    id: unknown;
    url: unknown;
    at: unknown;
  }>(
    `SELECT page_session_id AS id, url, captured_at AS at FROM ${WEBPAGE_CAPTURE_TABLE}
     UNION ALL
     SELECT id, url, page_loaded_at AS at FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}`
  );
  for (const row of visit_rows) {
    const url = String(row.url);
    const at = row.at === null || row.at === undefined ? null : String(row.at);
    if (selector_matches(selector, url, at)) {
      ids.add(String(row.id));
      urls.add(url);
    }
  }

  // Fetch-log rows match on either URL, and extend only the URL sweep — not
  // the session-id set. A fetch row deleted because its final_url redirected
  // into a forgotten URL belongs to a DIFFERENT visit, whose own session must
  // survive (the fetch row is the artifact encoding the connection, and the
  // url/final_url DELETE removes it). Their timestamps are fetch times, not
  // visit times, so the time-range selector resolves them only through the
  // visit rows above (a fetch serves a visit).
  if (selector.kind !== "time_range") {
    const fetch_rows = await metadata_db.query<{
      url: unknown;
      final_url: unknown;
    }>(`SELECT url, final_url FROM ${WEBPAGE_FETCH_TABLE}`);
    for (const row of fetch_rows) {
      const url = String(row.url);
      const final_url =
        row.final_url === null || row.final_url === undefined
          ? null
          : String(row.final_url);
      if (selector_matches(selector, url, null)) {
        urls.add(url);
      }
      if (final_url !== null && selector_matches(selector, final_url, null)) {
        urls.add(final_url);
      }
    }
  }

  if (selector.kind === "url") {
    urls.add(selector.url);
  }
  return { page_session_ids: [...ids], urls: [...urls] };
}

/**
 * Sweeps visit_inbox table rows in the encrypted metadata store that match the
 * selector. A buffered visit may not yet have a resolved session id (it was
 * accepted over HTTP but not yet captured), so matching is by the stored
 * url/page_loaded_at rather than by id. Returns the count of rows deleted.
 */
async function sweep_visit_inbox(
  metadata_db: DuckDB,
  selector: ForgetSelector
): Promise<number> {
  const rows = await metadata_db.query<{
    id: string;
    url: string;
    page_loaded_at: string | null;
  }>(`SELECT id, url, page_loaded_at FROM ${VISIT_INBOX_TABLE}`);

  const to_delete = rows.filter((r) =>
    selector_matches(selector, r.url, r.page_loaded_at ?? null)
  );
  if (to_delete.length === 0) return 0;

  const { placeholders, params } = in_list(
    to_delete.map((r) => r.id),
    "iid"
  );
  await metadata_db.execute(
    `DELETE FROM ${VISIT_INBOX_TABLE} WHERE id IN (${placeholders})`,
    params
  );
  return to_delete.length;
}

/**
 * Sweeps plaintext dev-replay files under `<storage_base>/captures/` that
 * match the selector. Matching is by the file's url/page_loaded_at — a replay
 * file may reference a URL not yet in the database. Unreadable files are left
 * alone. Returns the count of files removed.
 */
function sweep_replay_captures(
  storage_base: string,
  selector: ForgetSelector
): number {
  const dir = path.join(storage_base, "captures");
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return 0; // Directory does not exist — nothing buffered.
  }
  let removed = 0;
  for (const entry of entries) {
    const file_path = path.join(dir, entry);
    try {
      const visit = JSON.parse(fs.readFileSync(file_path, "utf8")) as {
        url?: unknown;
        page_loaded_at?: unknown;
      };
      if (typeof visit.url !== "string") continue;
      const at =
        typeof visit.page_loaded_at === "string" ? visit.page_loaded_at : null;
      if (selector_matches(selector, visit.url, at)) {
        fs.unlinkSync(file_path);
        removed++;
      }
    } catch {
      // Unreadable or already-removed entry — not this sweep's problem.
    }
  }
  return removed;
}

/**
 * Deletes the plaintext dev-log files (`dev-log.jsonl` and its rotation
 * `dev-log.jsonl.1`) under the storage base, wholesale. The JSONL log
 * interleaves stage lines from every visit, so a forget cannot selectively
 * remove one URL's lines without rewriting the file — wholesale deletion is
 * the right trade-off for a dev-only artifact. A new file is created on the
 * next `dev_log()` append. Missing files are not an error. Returns the count
 * of files removed (0, 1, or 2).
 */
function sweep_dev_log(storage_base: string): number {
  let removed = 0;
  for (const name of [DEV_LOG_FILENAME, `${DEV_LOG_FILENAME}.1`]) {
    try {
      fs.unlinkSync(path.join(storage_base, name));
      removed++;
    } catch {
      // Missing or already removed — nothing to do.
    }
  }
  return removed;
}

/**
 * Forgets everything the selector matches, across every store that exists.
 *
 * @param metadata_db - The metadata store
 * @param content_cache - The encrypted content cache, or `null` when no cache
 *   store exists yet — forgetting must not create one
 * @param selector - What to forget
 * @param options.storage_base - When given, the plaintext dev-replay files
 *   (`captures/`) under it are swept too
 */
export async function forget(
  metadata_db: DuckDB,
  content_cache: ContentCache | null,
  selector: ForgetSelector,
  options: { storage_base?: string } = {}
): Promise<ForgetReport> {
  // Trees younger than the cascade's start are spared by the sweep so a
  // visit landing mid-forget cannot lose its just-created tree row.
  const started_at = new Date().toISOString();
  const targets = await resolve_targets(metadata_db, selector);

  // Sweep the encrypted inbox buffer first — before the metadata transaction
  // removes the resolved sessions, so a concurrent persist cannot resurrect a
  // forgotten visit after the metadata rows are gone.
  await sweep_visit_inbox(metadata_db, selector);

  const files_removed = options.storage_base
    ? sweep_replay_captures(options.storage_base, selector)
    : 0;
  const dev_log_files_removed = options.storage_base
    ? sweep_dev_log(options.storage_base)
    : 0;

  // Derived content before metadata (see module header).
  if (content_cache) {
    await content_cache.delete_items(targets.page_session_ids);
    for (const url of targets.urls) {
      await content_cache.delete_by_url(url);
    }
    if (selector.kind === "origin") {
      // Cache rows can hold URLs on the origin that no metadata row carries
      // (e.g. orphans from a forget run before the cache existed).
      await content_cache.delete_by_origin(selector.origin);
    }
  }

  if (targets.page_session_ids.length > 0 || targets.urls.length > 0) {
    await forget_metadata(metadata_db, selector, targets);
  }

  // Always sweep: completes a previously-failed sweep even when this
  // selector resolves nothing (the forgotten sessions are already gone).
  await sweep_empty_trees(metadata_db, started_at);
  // Fold the deletes out of the WAL promptly, matching the cache's standard.
  await metadata_db.exec("CHECKPOINT");

  // The in-memory outcome ring (dev observability) also encodes URLs.
  purge_outcomes((url) => selector_matches(selector, url, null));

  return {
    page_session_ids: targets.page_session_ids.length,
    urls: targets.urls.length,
    content_cache_swept: content_cache !== null,
    files_removed,
    dev_log_files_removed,
  };
}

/**
 * The metadata-side cascade: one transaction — on a dedicated connection, so
 * a concurrent visit write never joins (or gets rolled back with) the forget
 * — covering the fetch log, the capture rows, the activity sessions, and the
 * referrer scrub on surviving sessions. Trees left with no sessions are
 * removed afterwards by {@link sweep_empty_trees}.
 */
async function forget_metadata(
  metadata_db: DuckDB,
  selector: ForgetSelector,
  targets: ForgetTargets
): Promise<void> {
  const ids = in_list(targets.page_session_ids, "id");
  const urls = in_list(targets.urls, "url");
  const have_ids = targets.page_session_ids.length > 0;
  const have_urls = targets.urls.length > 0;

  await metadata_db.isolated_transaction(async (run) => {
    // Fetch-log rows: by session id, and by stored/final URL — a redirect can
    // land a forgotten URL in final_url under another session's fetch row.
    const fetch_clauses = [
      ...(have_ids ? [`page_session_id IN (${ids.placeholders})`] : []),
      ...(have_urls
        ? [`url IN (${urls.placeholders})`, `final_url IN (${urls.placeholders})`]
        : []),
    ];
    await run(
      `DELETE FROM ${WEBPAGE_FETCH_TABLE} WHERE ${fetch_clauses.join(" OR ")}`,
      { ...ids.params, ...urls.params }
    );

    if (have_ids) {
      await run(
        `DELETE FROM ${WEBPAGE_CAPTURE_TABLE}
         WHERE page_session_id IN (${ids.placeholders})`,
        ids.params
      );
      await run(
        `DELETE FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
         WHERE id IN (${ids.placeholders})`,
        ids.params
      );
    }

    // Surviving sessions must not keep encoding the forgotten pages through
    // their referrer fields. Cross-origin referrers are truncated to the
    // origin by referrer policy, so an origin forget also scrubs by prefix.
    const referrer_scrubs = [
      ...(have_urls ? [`referrer IN (${urls.placeholders})`] : []),
      ...(have_ids
        ? [`referrer_page_session_id IN (${ids.placeholders})`]
        : []),
    ];
    const scrub_params: Record<string, string> = {
      ...ids.params,
      ...urls.params,
    };
    if (selector.kind === "origin") {
      referrer_scrubs.push(`starts_with(referrer, $origin_prefix)`);
      scrub_params.origin_prefix = `${selector.origin}/`;
      referrer_scrubs.push(`referrer = $origin_exact`);
      scrub_params.origin_exact = selector.origin;
    }
    await run(
      `UPDATE ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       SET referrer = NULL, referrer_page_session_id = NULL
       WHERE ${referrer_scrubs.join(" OR ")}`,
      scrub_params
    );
  });
}

/**
 * Removes navigation trees with no remaining sessions — a tree row is itself
 * a record that a browsing session happened at a time. Runs OUTSIDE the
 * forget transaction (DuckDB cannot delete a foreign-key parent in the same
 * transaction as its children) and spares trees newer than `cutoff` so a
 * concurrently-arriving visit keeps the tree row it just created. Idempotent:
 * a failed sweep is completed by any later forget.
 */
async function sweep_empty_trees(
  metadata_db: DuckDB,
  cutoff: string
): Promise<void> {
  await metadata_db.execute(
    `DELETE FROM ${WEBPAGE_TREES_TABLE}
     WHERE id NOT IN (SELECT DISTINCT tree_id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE})
       AND latest_activity_time <= $cutoff`,
    { cutoff }
  );
}
