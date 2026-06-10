/**
 * The encrypted on-demand re-download content cache: a separate, quarantined
 * tier holding re-downloaded public page content for consumers that need to
 * read it repeatedly (Temporal Topic Detection, RAG, a research project).
 *
 * The cache is never the source of truth — the metadata record is. Content
 * enters through `CachedCorpus`: the default content read path populates it
 * under the `"default"` scope as pages are re-downloaded, and a scoped consumer
 * (a TDT run, a research project) caches under its own scope. The store is its
 * own encrypted DuckDB file with its own OS-keystore key (separate from the
 * metadata store's, so destroying the cache key destroys only the cache), and
 * every item is deletable for the right-to-forget cascade (`right_to_forget.ts`).
 *
 * Quarantine: the file lives under the extension's storage base, never inside
 * the syncable metadata artifact or the PKM repo (dev runs use the gitignored,
 * unpackaged `.dev-storage/`). If the surrounding directory is ever swept into
 * a backup or sync the file rides along as ciphertext — encryption, not
 * location, is the load-bearing defense.
 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as vscode from "vscode";
import { blobValue, DuckDBBlobValue } from "@duckdb/node-api";
import { DuckDB } from "../duck_db";
import {
  CONTENT_CACHE_KEY_SECRET,
  get_or_create_store_key,
} from "../database/encryption_key";
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
 * Compresses the markdown body for storage. Brotli is built into the Node 20
 * extension host (zstd is not), needs no dependency, and compresses prose well.
 * Returns a DuckDB BLOB value so the bind layer stores raw bytes, not text.
 */
function compress_content(markdown: string): DuckDBBlobValue {
  return blobValue(zlib.brotliCompressSync(Buffer.from(markdown, "utf8")));
}

/**
 * Reverses {@link compress_content}. A BLOB column reads back as a
 * {@link DuckDBBlobValue}; decoding its bytes yields the original markdown.
 * Anything else means a pre-brotli cache file — the dev reset (wipe, never
 * ALTER) recreates the store with the current schema.
 */
function decompress_content(value: unknown): string {
  if (!(value instanceof DuckDBBlobValue)) {
    throw new Error(
      "cached content is not a BLOB — stale content_cache.db; wipe it (see backlog/docs/dev-db-reset.md)"
    );
  }
  return zlib.brotliDecompressSync(value.bytes).toString("utf8");
}

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
    "content BLOB NOT NULL", // extracted main-content markdown, brotli-compressed
    "author TEXT", // Defuddle-derived metadata, as parsed at re-download time
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
 * The canonical open path for the content cache. Derives the store path from
 * the storage base, sources the cache's own key from `SecretStorage` with the
 * existence guard computed against that same path (so a transient keystore
 * failure can never silently re-key an existing cache), opens the encrypted
 * store, and creates the schema. Every consumer (the right-to-forget cascade,
 * TDT) opens through here — hand-rolling the sequence risks pairing the wrong
 * existence check with the key lookup.
 */
export async function open_content_cache(
  secrets: vscode.SecretStorage,
  storage_base: string
): Promise<ContentCache> {
  const database_path = path.join(storage_base, CONTENT_CACHE_DB_FILENAME);
  const encryption_key = await get_or_create_store_key(
    secrets,
    CONTENT_CACHE_KEY_SECRET,
    fs.existsSync(database_path)
  );
  const db = new DuckDB({ database_path, encryption_key });
  await db.init();
  await create_content_cache_schema(db);
  return new ContentCache(db);
}

/**
 * Opens the content cache only when its store file already exists, else
 * returns null. The right-to-forget cascade and any other delete-only
 * consumer uses this: forgetting (or sweeping) must never create a cache.
 */
export async function open_content_cache_if_exists(
  secrets: vscode.SecretStorage,
  storage_base: string
): Promise<ContentCache | null> {
  const database_path = path.join(storage_base, CONTENT_CACHE_DB_FILENAME);
  if (!fs.existsSync(database_path)) {
    return null;
  }
  return open_content_cache(secrets, storage_base);
}

/**
 * Read/write/delete surface over the encrypted content-cache store. One row
 * per page session: re-caching a page (same deterministic id) replaces the
 * prior entry, so a fresher fetch wins and the newest WRITER's scope owns the
 * row — a cache hit does not re-attribute scope (see {@link ContentCache.delete_scope}).
 */
export class ContentCache {
  constructor(private readonly db: DuckDB) {}

  /** Closes the underlying encrypted store (checkpoints the WAL away). */
  async close(): Promise<void> {
    await this.db.close();
  }

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
      content: decompress_content(row.content),
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
        content: compress_content(content.content),
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
   * Deletes one cached item — single-item convenience over
   * {@link delete_items}. Deleting an id that is not cached is a no-op.
   */
  async delete_item(page_session_id: string): Promise<void> {
    await this.delete_items([page_session_id]);
  }

  /**
   * Batch deletion: one DELETE and one CHECKPOINT for the whole set — the
   * shape the right-to-forget cascade (`right_to_forget.ts`) uses, so a
   * time-range forget over N pages does not pay N WAL flushes. The delete is
   * checkpointed so the rows leave the WAL and the live table immediately;
   * their ciphertext may persist in freed blocks inside the file until
   * DuckDB reuses them — unreadable without the cache key, and destroying
   * the key (or emptying the cache, which truncates the file) destroys it
   * outright.
   *
   * Ordering constraint for the cascade: cache rows are resolved FROM the
   * metadata store, so derived tiers must be deleted before — or resolved
   * before deleting — the metadata rows, or orphaned cache rows become
   * unaddressable except by {@link delete_by_url} / {@link delete_by_origin}.
   */
  async delete_items(page_session_ids: string[]): Promise<void> {
    if (page_session_ids.length === 0) {
      return;
    }
    const params: Record<string, string> = {};
    const placeholders = page_session_ids.map((id, i) => {
      params[`id${i}`] = id;
      return `$id${i}`;
    });
    await this.db.execute(
      `DELETE FROM ${CACHED_CONTENT_TABLE}
       WHERE page_session_id IN (${placeholders.join(", ")})`,
      params
    );
    await this.db.exec("CHECKPOINT");
  }

  /**
   * Deletes every cached copy of a URL — the selector the cache serves
   * natively (no metadata-store join), and the cleanup for rows orphaned by a
   * metadata delete.
   */
  async delete_by_url(url: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM ${CACHED_CONTENT_TABLE} WHERE url = $url`,
      { url }
    );
    await this.db.exec("CHECKPOINT");
  }

  /**
   * Deletes every cached row whose URL belongs to the origin — the
   * right-to-forget cascade's sweep for cache rows no metadata row carries
   * (origin equality requires URL parsing, so the rows are matched here, not
   * by a SQL prefix).
   */
  async delete_by_origin(origin: string): Promise<void> {
    const rows = await this.db.query<{ url: unknown }>(
      `SELECT DISTINCT url FROM ${CACHED_CONTENT_TABLE}`
    );
    const matching = rows
      .map((row) => String(row.url))
      .filter((url) => {
        try {
          return new URL(url).origin === origin;
        } catch {
          return false;
        }
      });
    if (matching.length === 0) {
      return;
    }
    const params: Record<string, string> = {};
    const placeholders = matching.map((url, i) => {
      params[`url${i}`] = url;
      return `$url${i}`;
    });
    await this.db.execute(
      `DELETE FROM ${CACHED_CONTENT_TABLE} WHERE url IN (${placeholders.join(", ")})`,
      params
    );
    await this.db.exec("CHECKPOINT");
  }

  /**
   * Deletes every item cached under a scope (e.g. a finished project). This
   * is best-effort eviction, not right-to-forget: a cache hit does not
   * re-attribute a row's scope, so a row written by scope A and later read by
   * scope B is deleted with A's scope and survives B's. The forget primitive
   * is {@link delete_item} / {@link delete_by_url} via the 39.5 cascade.
   */
  async delete_scope(scope: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM ${CACHED_CONTENT_TABLE} WHERE scope = $scope`,
      { scope }
    );
    await this.db.exec("CHECKPOINT");
  }
}
