/**
 * The cascading right-to-forget primitive (constitution principle 4).
 * Forgetting — by URL, by origin, or by time-range — deletes the metadata
 * rows AND every artifact that encodes the forgotten pages: the fetch log
 * (matched by stored URL and by post-redirect final URL), the encrypted
 * content cache, the plaintext visit-inbox and dev replay files buffered
 * under the storage base, and the in-memory visit-outcome ring. Forgetting
 * is deletion, not hiding: surviving visits' referrer fields are scrubbed
 * and navigation trees left empty are removed.
 *
 * THIS MODULE IS THE CASCADE'S SINGLE HOME: every derived store joins it as
 * it lands. Today that is the metadata tables, the TDT page-vector cache
 * (`topic_page_vector`, task-36.3.1), the TDT cluster memberships
 * (`topic_cluster_member`, task-36.6), the encrypted content cache (task-39.3),
 * and the plaintext visit buffers; RAG vectors (task-31) are added here when that
 * store exists (each carries an acceptance criterion pointing back at this
 * module). Page vectors and cluster memberships live in the metadata file and are
 * keyed by `page_session_id`, so they are deleted by the resolved id set inside
 * the metadata transaction — atomic with the rows they derive from, with no
 * separate-file ordering concern.
 *
 * A forget removes a forgotten page's `topic_cluster_member` rows (which carry its
 * `page_session_id` and a denormalized `page_loaded_at` — visit metadata). It does
 * NOT delete the `topic_cluster` / `topic_run` rows. The per-page embedding — the
 * reconstructable artifact — lives in `topic_page_vector` and IS deleted; what a
 * retained cluster keeps is its frozen `representative_vector` (the L2-normalized
 * mean of its members) and `exemplar_page_session_id`. The mean is an irreversible
 * aggregate, but honestly: for a small cluster (min size 3) it still carries a
 * bounded contribution from a forgotten member, and the retained cluster may now
 * reference a forgotten exemplar page or overstate its `size`. This residual is
 * accepted because it is non-reconstructable and short-lived — the next clustering
 * run over that window re-keys without the forgotten page (its `input_fingerprint`
 * changes) and atomically replaces the stale cluster/run. Consumers must therefore
 * tolerate a dangling `exemplar_page_session_id` (it is a soft ref) until then.
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
  TOPIC_CLUSTER_MEMBER_TABLE,
  TOPIC_PAGE_VECTOR_TABLE,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  WEBPAGE_TREES_TABLE,
} from "./duck_db";
import { ContentCache } from "./redownload/content_cache";
import { purge_outcomes } from "./dev_log";

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
  /**
   * TDT page vectors deleted from `topic_page_vector` for the forgotten pages.
   * Counted before the cascade transaction, so under a concurrent embed pass the
   * figure can drift (a vector written between the count and the DELETE is still
   * deleted but not counted). The DELETE itself is authoritative; only this
   * report number is best-effort.
   */
  page_vectors_deleted: number;
  /**
   * TDT cluster memberships deleted from `topic_cluster_member` for the forgotten
   * pages. Like `page_vectors_deleted`, counted before the cascade transaction, so
   * a concurrent clustering write can make the figure drift; the DELETE itself is
   * authoritative.
   */
  cluster_members_deleted: number;
  /** Whether the content-cache cascade ran (false when no cache exists). */
  content_cache_swept: boolean;
  /** Plaintext buffer files (visit inbox + dev replay ring) removed. */
  files_removed: number;
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
 * Sweeps the plaintext visit buffers under the storage base — the durable
 * visit inbox (`visit_inbox/`) and the dev replay ring (`captures/`) — both
 * of which hold full visit JSON (url, title, referrer, timestamps) for
 * exactly the visits a forget targets. Matching is by the file's own
 * url/page_loaded_at, not by resolved ids: a buffered visit may never have
 * reached the database. Unreadable files are left alone.
 */
function sweep_visit_files(
  storage_base: string,
  selector: ForgetSelector
): number {
  let removed = 0;
  for (const dir_name of ["visit_inbox", "captures"]) {
    const dir = path.join(storage_base, dir_name);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue; // Directory does not exist — nothing buffered.
    }
    for (const entry of entries) {
      const file_path = path.join(dir, entry);
      try {
        const visit = JSON.parse(fs.readFileSync(file_path, "utf8")) as {
          url?: unknown;
          page_loaded_at?: unknown;
        };
        if (typeof visit.url !== "string") continue;
        const at =
          typeof visit.page_loaded_at === "string"
            ? visit.page_loaded_at
            : null;
        if (selector_matches(selector, visit.url, at)) {
          fs.unlinkSync(file_path);
          removed++;
        }
      } catch {
        // Unreadable or already-removed entry — not this sweep's problem.
      }
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
 * @param options.storage_base - When given, the plaintext visit buffers
 *   (visit inbox, dev replay ring) under it are swept too
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

  const files_removed = options.storage_base
    ? sweep_visit_files(options.storage_base, selector)
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

  // Page vectors and cluster memberships are keyed by page_session_id and live in
  // the metadata file, so they are counted here and deleted inside
  // forget_metadata's transaction.
  const page_vectors_deleted = await count_page_vectors(
    metadata_db,
    targets.page_session_ids
  );
  const cluster_members_deleted = await count_cluster_members(
    metadata_db,
    targets.page_session_ids
  );

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
    page_vectors_deleted,
    cluster_members_deleted,
    content_cache_swept: content_cache !== null,
    files_removed,
  };
}

/**
 * Counts the page vectors the cascade will delete — the rows in
 * `topic_page_vector` for the resolved sessions, across every embedding model.
 * Read before the metadata transaction removes them, so the report can state
 * how many vectors the forget destroyed.
 */
async function count_page_vectors(
  metadata_db: DuckDB,
  page_session_ids: string[]
): Promise<number> {
  if (page_session_ids.length === 0) {
    return 0;
  }
  const ids = in_list(page_session_ids, "id");
  const row = await metadata_db.query_first<{ n: unknown }>(
    `SELECT count(*) AS n FROM ${TOPIC_PAGE_VECTOR_TABLE}
     WHERE page_session_id IN (${ids.placeholders})`,
    ids.params
  );
  return Number(row?.n ?? 0);
}

/**
 * Counts the TDT cluster memberships the cascade will delete — the rows in
 * `topic_cluster_member` for the resolved sessions, across every run. Read before
 * the metadata transaction removes them, mirroring {@link count_page_vectors}.
 */
async function count_cluster_members(
  metadata_db: DuckDB,
  page_session_ids: string[]
): Promise<number> {
  if (page_session_ids.length === 0) {
    return 0;
  }
  const ids = in_list(page_session_ids, "id");
  const row = await metadata_db.query_first<{ n: unknown }>(
    `SELECT count(*) AS n FROM ${TOPIC_CLUSTER_MEMBER_TABLE}
     WHERE page_session_id IN (${ids.placeholders})`,
    ids.params
  );
  return Number(row?.n ?? 0);
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
      // TDT page vectors derive from these pages and key on page_session_id, so
      // they are forgotten by the resolved id set — atomically, in the same
      // metadata transaction (no separate-file ordering concern). A url/origin/
      // time-range selector resolves to these ids, so id-matching covers all
      // selector kinds; vectors carry no URL, so there is nothing else to match.
      await run(
        `DELETE FROM ${TOPIC_PAGE_VECTOR_TABLE}
         WHERE page_session_id IN (${ids.placeholders})`,
        ids.params
      );
      // TDT cluster memberships carry the forgotten page's id + visit time; delete
      // them in the same transaction. The cluster/run rows (irreversible aggregate
      // vectors, window-level provenance) are left for the next run to re-key (see
      // module header).
      await run(
        `DELETE FROM ${TOPIC_CLUSTER_MEMBER_TABLE}
         WHERE page_session_id IN (${ids.placeholders})`,
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
