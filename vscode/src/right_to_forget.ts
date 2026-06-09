/**
 * The cascading right-to-forget primitive (constitution principle 4).
 * Forgetting — by URL, by origin, or by time-range — deletes the metadata
 * rows AND every derived artifact that exists. Forgetting is deletion, not
 * hiding: no surviving row may continue to encode the forgotten pages, so
 * the cascade also scrubs referrer fields on surviving visits and removes
 * navigation trees left empty.
 *
 * THIS MODULE IS THE CASCADE'S SINGLE HOME: every derived store joins it as
 * it lands. Today that is the metadata tables and the encrypted content
 * cache (task-39.3); TDT cluster tables (task-36) and RAG vectors (task-31)
 * are added here when those stores exist.
 *
 * Ordering and atomicity, honestly: the metadata-side deletes run in ONE
 * transaction, but cross-store atomicity over two database files is not
 * possible. The cascade therefore resolves its targets from metadata first,
 * deletes derived content first, and is idempotent — a failure between
 * stores can only leave metadata without content (the safe direction), and
 * re-running the same forget completes it.
 */
import {
  DuckDB,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  WEBPAGE_TREES_TABLE,
} from "./duck_db";
import { ContentCache } from "./redownload/content_cache";

/** What to forget. Time bounds are ISO-8601 strings, inclusive. */
export type ForgetSelector =
  | { kind: "url"; url: string }
  | { kind: "origin"; origin: string }
  | { kind: "time_range"; from: string; to: string };

/** What one forget removed, per store. */
export interface ForgetReport {
  /** Page sessions resolved by the selector (capture and/or activity rows). */
  page_session_ids: number;
  /** Distinct URLs those sessions covered. */
  urls: number;
  /** Whether the content-cache cascade ran (false when no cache exists). */
  content_cache_swept: boolean;
}

/** The resolved blast radius of a selector: session ids and their URLs. */
interface ForgetTargets {
  page_session_ids: string[];
  urls: string[];
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

/** True when the URL parses and its origin equals the given origin. */
function has_origin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Resolves the selector to the page sessions (and their URLs) it forgets.
 * Both `webpage_capture` and `webpage_activity_sessions` are consulted — a
 * session can exist in either before the other. Origin matching parses each
 * stored URL (`URL.origin` equality) rather than trusting a prefix LIKE.
 */
async function resolve_targets(
  metadata_db: DuckDB,
  selector: ForgetSelector
): Promise<ForgetTargets> {
  const rows = await metadata_db.query<{ id: unknown; url: unknown; at: unknown }>(
    `SELECT page_session_id AS id, url, captured_at AS at FROM ${WEBPAGE_CAPTURE_TABLE}
     UNION ALL
     SELECT id, url, page_loaded_at AS at FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}`
  );
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const row of rows) {
    const id = String(row.id);
    const url = String(row.url);
    const at = String(row.at);
    const matches =
      selector.kind === "url"
        ? url === selector.url
        : selector.kind === "origin"
          ? has_origin(url, selector.origin)
          : at >= selector.from && at <= selector.to;
    if (matches) {
      ids.add(id);
      urls.add(url);
    }
  }
  return { page_session_ids: [...ids], urls: [...urls] };
}

/**
 * Forgets everything the selector matches, across every store that exists.
 *
 * @param metadata_db - The metadata store
 * @param content_cache - The encrypted content cache, or `null` when no cache
 *   store exists yet — forgetting must not create one
 * @param selector - What to forget
 */
export async function forget(
  metadata_db: DuckDB,
  content_cache: ContentCache | null,
  selector: ForgetSelector
): Promise<ForgetReport> {
  const targets = await resolve_targets(metadata_db, selector);
  if (targets.page_session_ids.length === 0) {
    return { page_session_ids: 0, urls: 0, content_cache_swept: false };
  }

  // Derived content first (see module header): one batch per primitive, and
  // delete_by_url sweeps rows another session id may have cached for the
  // same forgotten URL.
  if (content_cache) {
    await content_cache.delete_items(targets.page_session_ids);
    for (const url of targets.urls) {
      await content_cache.delete_by_url(url);
    }
  }

  await forget_metadata(metadata_db, selector, targets);

  return {
    page_session_ids: targets.page_session_ids.length,
    urls: targets.urls.length,
    content_cache_swept: content_cache !== null,
  };
}

/**
 * The metadata-side cascade, in one transaction: the fetch log, the capture
 * rows, the activity sessions, the referrer fields on surviving sessions
 * that encode forgotten pages, and the trees left with no sessions.
 */
async function forget_metadata(
  metadata_db: DuckDB,
  selector: ForgetSelector,
  targets: ForgetTargets
): Promise<void> {
  const ids = in_list(targets.page_session_ids, "id");
  const urls = in_list(targets.urls, "url");

  await metadata_db.exec("BEGIN TRANSACTION");
  try {
    // Fetch-log rows: by session id, and by stored/final URL — a redirect can
    // land a forgotten URL in final_url under another session's fetch row.
    await metadata_db.execute(
      `DELETE FROM ${WEBPAGE_FETCH_TABLE}
       WHERE page_session_id IN (${ids.placeholders})
          OR url IN (${urls.placeholders})
          OR final_url IN (${urls.placeholders})`,
      { ...ids.params, ...urls.params }
    );

    await metadata_db.execute(
      `DELETE FROM ${WEBPAGE_CAPTURE_TABLE}
       WHERE page_session_id IN (${ids.placeholders})`,
      ids.params
    );

    await metadata_db.execute(
      `DELETE FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       WHERE id IN (${ids.placeholders})`,
      ids.params
    );

    // Surviving sessions must not keep encoding the forgotten pages through
    // their referrer fields. Cross-origin referrers are truncated to the
    // origin by referrer policy, so an origin forget also scrubs by prefix.
    const referrer_scrubs = [
      `referrer IN (${urls.placeholders})`,
      `referrer_page_session_id IN (${ids.placeholders})`,
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
    await metadata_db.execute(
      `UPDATE ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       SET referrer = NULL, referrer_page_session_id = NULL
       WHERE ${referrer_scrubs.join(" OR ")}`,
      scrub_params
    );

    await metadata_db.exec("COMMIT");
  } catch (error) {
    await metadata_db.exec("ROLLBACK");
    throw error;
  }

  // A tree whose every session was forgotten is itself a record that a
  // browsing session happened at a time — remove it. This runs AFTER the
  // transaction because DuckDB cannot delete a foreign-key parent in the
  // same transaction as its children (the in-transaction FK index still
  // sees the deleted sessions). Tree rows hold only an id and timestamps —
  // no URL or content — and this sweep is idempotent: if it fails, the next
  // forget (or this one re-run) completes it.
  await metadata_db.exec(
    `DELETE FROM ${WEBPAGE_TREES_TABLE}
     WHERE id NOT IN (SELECT DISTINCT tree_id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE})`
  );
}
