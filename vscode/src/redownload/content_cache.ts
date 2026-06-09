/**
 * The encrypted on-demand re-download content cache: a separate, quarantined
 * tier holding re-downloaded public page content for consumers that need to
 * read it repeatedly (Temporal Topic Detection, RAG, a research project).
 *
 * The cache is never the source of truth — the metadata record is — and it is
 * never populated ambiently: content enters only when a consumer explicitly
 * caches a page under a named scope (see `CachedCorpus`). The store is its own
 * encrypted DuckDB file with its own OS-keystore key (separate from the
 * metadata store's, so destroying the cache key destroys only the cache), it
 * lives under the extension's storage base — outside any git-tracked,
 * syncable, or developer-controlled directory — and every item is deletable
 * for the right-to-forget cascade (task-39.5).
 */
import { DuckDB } from "../duck_db";
import { CorpusContent } from "./corpus";

/** Filename of the encrypted content-cache store under the storage base. */
export const CONTENT_CACHE_DB_FILENAME = "content_cache.db";

const CACHED_CONTENT_TABLE = "cached_content";

/** Columns of {@link CACHED_CONTENT_TABLE}, in insert/select order. */
const CACHED_CONTENT_COLUMNS = [
  "page_session_id",
  "url",
  "scope",
  "title",
  "content",
  "site_name",
  "author",
  "published_at",
  "lang",
  "fetched_at",
  "http_status",
  "content_hash",
  "cached_at",
] as const;

/**
 * Creates the content-cache schema (idempotent). Called once after
 * {@link DuckDB.init} by the owner of the cache store.
 */
export async function create_content_cache_schema(db: DuckDB): Promise<void> {
  const cached_content_schema = [
    "page_session_id TEXT PRIMARY KEY", // the metadata row this content serves
    "url TEXT NOT NULL", // the public URL the content was re-downloaded from
    "scope TEXT NOT NULL", // the named consumer that requested caching
    "title TEXT NOT NULL",
    "content TEXT NOT NULL", // the re-downloaded public HTML
    "author TEXT", // <meta>-derived fields, as parsed at fetch time
    "site_name TEXT",
    "published_at TEXT",
    "lang TEXT",
    "fetched_at TEXT NOT NULL", // fidelity of the cached fetch
    "http_status INTEGER NOT NULL",
    "content_hash TEXT NOT NULL",
    "cached_at TEXT NOT NULL", // when the entry was written to the cache
  ].join(", ");
  await db.create_table(CACHED_CONTENT_TABLE, cached_content_schema);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_cached_content_scope
                 ON ${CACHED_CONTENT_TABLE}(scope)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_cached_content_url
                 ON ${CACHED_CONTENT_TABLE}(url)`);
}

/**
 * Read/write/delete surface over the encrypted content-cache store. One row
 * per page session: re-caching a page (same deterministic id) replaces the
 * prior entry, so a fresher fetch wins and the newest scope owns the row.
 */
export class ContentCache {
  constructor(private readonly db: DuckDB) {}

  /** Reads a cached page's content, or null on a miss. */
  async get(page_session_id: string): Promise<CorpusContent | null> {
    const row = await this.db.query_first<Record<string, unknown>>(
      `SELECT ${CACHED_CONTENT_COLUMNS.join(", ")}
       FROM ${CACHED_CONTENT_TABLE}
       WHERE page_session_id = $id`,
      { id: page_session_id }
    );
    if (!row) return null;
    const text = (value: unknown): string | null =>
      value === null || value === undefined ? null : String(value);
    return {
      page_session_id: String(row.page_session_id),
      url: String(row.url),
      title: String(row.title),
      content: String(row.content),
      site_name: text(row.site_name),
      author: text(row.author),
      published_at: text(row.published_at),
      lang: text(row.lang),
      fetched_at: String(row.fetched_at),
      http_status: Number(row.http_status),
      content_hash: String(row.content_hash),
    };
  }

  /**
   * Caches one successfully re-downloaded page under a named scope. Only an
   * `ok` re-download has content to cache — exclusions (auth/paywall/dead)
   * never enter the cache.
   */
  async put(content: CorpusContent, scope: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO ${CACHED_CONTENT_TABLE}
        (${CACHED_CONTENT_COLUMNS.join(", ")})
       VALUES
        ($page_session_id, $url, $scope, $title, $content, $site_name,
         $author, $published_at, $lang, $fetched_at, $http_status,
         $content_hash, $cached_at)
       ON CONFLICT (page_session_id) DO UPDATE SET
         url = excluded.url,
         scope = excluded.scope,
         title = excluded.title,
         content = excluded.content,
         site_name = excluded.site_name,
         author = excluded.author,
         published_at = excluded.published_at,
         lang = excluded.lang,
         fetched_at = excluded.fetched_at,
         http_status = excluded.http_status,
         content_hash = excluded.content_hash,
         cached_at = excluded.cached_at`,
      {
        page_session_id: content.page_session_id,
        url: content.url,
        scope,
        title: content.title,
        content: content.content,
        site_name: content.site_name,
        author: content.author,
        published_at: content.published_at,
        lang: content.lang,
        fetched_at: content.fetched_at,
        http_status: content.http_status,
        content_hash: content.content_hash,
        cached_at: new Date().toISOString(),
      }
    );
  }

  /**
   * Deletes one cached item — the per-item primitive the right-to-forget
   * cascade (task-39.5) calls. The delete is checkpointed so the row leaves
   * the WAL immediately; freed blocks inside the (encrypted) file are
   * reclaimed by DuckDB on subsequent checkpoints.
   */
  async delete_item(page_session_id: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM ${CACHED_CONTENT_TABLE} WHERE page_session_id = $id`,
      { id: page_session_id }
    );
    await this.db.exec("CHECKPOINT");
  }

  /** Deletes every item cached under a scope (e.g. a finished project). */
  async delete_scope(scope: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM ${CACHED_CONTENT_TABLE} WHERE scope = $scope`,
      { scope }
    );
    await this.db.exec("CHECKPOINT");
  }
}
