import { DuckDBValue } from "@duckdb/node-api";
import {
  PageCapture,
  WebpageFetch,
  WebpageFetchSchema,
} from "../page_capture_models";
import { md5_hash } from "../hash_utils";
import { DuckDB } from "./connection";
import { WEBPAGE_CAPTURE_TABLE, WEBPAGE_FETCH_TABLE } from "./table_names";

/** Insert placeholders and select projections are both derived from this order. */
const WEBPAGE_FETCH_COLUMNS = [
  "fetch_id",
  "page_session_id",
  "url",
  "final_url",
  "outcome",
  "http_status",
  "content_hash",
  "content_type",
  "author",
  "published_at",
  "lang",
  "site_name",
  "fetched_at",
] as const;

/**
 * Inserts (or replaces) a capture's browsing metadata. No page content is
 * stored — content and <meta>-derived fields come from re-download.
 */
export async function insert_webpage_capture(
  db: DuckDB,
  capture: PageCapture
): Promise<void> {
  await db.execute(
    `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
      (page_session_id, url, title, content_type, captured_at)
     VALUES ($page_session_id, $url, $title, $content_type, $captured_at)
     ON CONFLICT (page_session_id) DO UPDATE SET
       url = excluded.url,
       title = excluded.title,
       content_type = excluded.content_type,
       captured_at = excluded.captured_at`,
    {
      page_session_id: capture.page_session_id,
      url: capture.url,
      title: capture.title,
      content_type: capture.content_type,
      captured_at: capture.captured_at,
    }
  );
}

export async function get_webpage_capture(
  db: DuckDB,
  page_session_id: string
): Promise<PageCapture | null> {
  const row = await db.query_first<Record<string, DuckDBValue>>(
    `SELECT page_session_id, url, title, content_type, captured_at
     FROM ${WEBPAGE_CAPTURE_TABLE} WHERE page_session_id = $id`,
    { id: page_session_id }
  );
  if (!row) return null;
  return {
    page_session_id: row.page_session_id.toString(),
    url: row.url.toString(),
    title: row.title.toString(),
    content_type: row.content_type.toString(),
    captured_at: row.captured_at.toString(),
  };
}

/**
 * Lists every stored capture's page_session_id and url — the fetch targets
 * the re-download corpus iterates to build the public subset.
 */
export async function list_capture_targets(
  db: DuckDB
): Promise<{ page_session_id: string; url: string }[]> {
  const rows = await db.query<Record<string, DuckDBValue>>(
    `SELECT page_session_id, url FROM ${WEBPAGE_CAPTURE_TABLE}`
  );
  return rows.map((row) => ({
    page_session_id: row.page_session_id.toString(),
    url: row.url.toString(),
  }));
}

export async function get_page_by_title(
  db: DuckDB,
  title: string
): Promise<PageCapture | null> {
  const result = await db.connection.runAndReadAll(
    `SELECT page_session_id FROM ${WEBPAGE_CAPTURE_TABLE}
     WHERE title = $title LIMIT 1`,
    { title }
  );
  const rows = result.getRowObjects();
  if (rows.length === 0) return null;
  return get_webpage_capture(db, rows[0].page_session_id.toString());
}

export async function get_webpage_by_url(
  db: DuckDB,
  url: string
): Promise<{ url: string; title: string; visited_at: string } | null> {
  const result = await db.connection.runAndReadAll(
    `SELECT
       s.url,
       COALESCE(c.title, '') as title,
       s.page_loaded_at as visited_at
     FROM webpage_activity_sessions s
     LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
     WHERE s.url = $url
     ORDER BY s.page_loaded_at DESC
     LIMIT 1`,
    { url }
  );
  const rows = result.getRowObjects();
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    url: row.url.toString(),
    title: row.title.toString(),
    visited_at: row.visited_at.toString(),
  };
}

/**
 * Appends one re-download fetch record (outcome + fidelity + parsed <meta>).
 * The row is keyed by a deterministic fetch_id; an identical replay of the
 * same attempt is idempotent (ON CONFLICT DO NOTHING), while two genuinely
 * distinct fetches each append a row, preserving drift history.
 */
export async function insert_webpage_fetch(
  db: DuckDB,
  fetch: WebpageFetch
): Promise<void> {
  const fetch_id = md5_hash(
    `${fetch.page_session_id}:${fetch.fetched_at}:${fetch.outcome}:${fetch.content_hash ?? ""}`
  );
  const params: Record<string, DuckDBValue> = {
    fetch_id,
    page_session_id: fetch.page_session_id,
    url: fetch.url,
    final_url: fetch.final_url,
    outcome: fetch.outcome,
    http_status: fetch.http_status,
    content_hash: fetch.content_hash,
    content_type: fetch.content_type,
    author: fetch.author,
    published_at: fetch.published_at,
    lang: fetch.lang,
    site_name: fetch.site_name,
    fetched_at: fetch.fetched_at,
  };
  const columns = WEBPAGE_FETCH_COLUMNS.join(", ");
  const placeholders = WEBPAGE_FETCH_COLUMNS.map((c) => `$${c}`).join(", ");
  await db.execute(
    `INSERT INTO ${WEBPAGE_FETCH_TABLE} (${columns}) VALUES (${placeholders})
     ON CONFLICT (fetch_id) DO NOTHING`,
    params
  );
}

/**
 * A page session accumulates many rows in the append-only fetch log; the most
 * recent by fetched_at is its current fidelity/drift state.
 */
export async function get_latest_webpage_fetch(
  db: DuckDB,
  page_session_id: string
): Promise<WebpageFetch | null> {
  const row = await db.query_first<Record<string, DuckDBValue>>(
    `SELECT ${WEBPAGE_FETCH_COLUMNS.join(", ")}
     FROM ${WEBPAGE_FETCH_TABLE}
     WHERE page_session_id = $id
     ORDER BY fetched_at DESC LIMIT 1`,
    { id: page_session_id }
  );
  if (!row) return null;
  const text = (value: DuckDBValue): string | null =>
    value === null || value === undefined ? null : value.toString();
  return {
    page_session_id: row.page_session_id.toString(),
    url: row.url.toString(),
    final_url: text(row.final_url),
    outcome: WebpageFetchSchema.shape.outcome.parse(row.outcome.toString()),
    http_status:
      row.http_status === null || row.http_status === undefined
        ? null
        : Number(row.http_status),
    content_hash: text(row.content_hash),
    content_type: text(row.content_type),
    author: text(row.author),
    published_at: text(row.published_at),
    lang: text(row.lang),
    site_name: text(row.site_name),
    fetched_at: row.fetched_at.toString(),
  };
}
