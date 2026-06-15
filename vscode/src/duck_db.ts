import {
  DuckDBInstance,
  DuckDBConnection,
  DuckDBValue,
} from "@duckdb/node-api";
import * as path from "path";
import * as fs from "fs";
import {
  PageCapture,
  PageActivitySessionWithMeta,
  PageActivitySessionWithMetaSchema,
  WebpageFetch,
  WebpageFetchSchema,
} from "./page_capture_models";
import { md5_hash } from "./hash_utils";
import {
  PageActivitySession,
  PageActivitySessionSchema,
} from "./duck_db_models";

/**
 * Configuration options for DuckDB database connection
 * @interface DuckDBConfig
 */
export interface DuckDBConfig {
  /**
   * File system path where the database will be stored, or `:memory:` for an
   * ephemeral in-memory database (tests).
   */
  database_path: string;
  /**
   * Key encrypting the database file at rest (DuckDB native encryption).
   * Required for file-backed databases — a file store is only ever created
   * encrypted, and there is no plaintext fallback (see docs/threat-model.md).
   * Must be omitted for `:memory:` databases, which never touch disk.
   */
  encryption_key?: string;
}

/** Alias under which the encrypted database file is attached. */
const STORE_ALIAS = "bergamot_store";

/**
 * Normalized open target: an ephemeral in-memory database, or an encrypted
 * file-backed store. The discriminated shape makes "file ⇒ key" structural.
 */
type StoreTarget =
  | { in_memory: true }
  | { in_memory: false; database_path: string; encryption_key: string };

/** Escapes a value for inclusion in a single-quoted SQL string literal. */
function sql_string_literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Exported solely for the right-to-forget cascade (right_to_forget.ts),
// which must remain a single auditable module; all other metadata access
// goes through this module's functions.
export const WEBPAGE_ACTIVITY_SESSIONS_TABLE = "webpage_activity_sessions";
export const WEBPAGE_TREES_TABLE = "webpage_trees";
export const WEBPAGE_CAPTURE_TABLE = "webpage_capture";
export const WEBPAGE_FETCH_TABLE = "webpage_fetch";
// Durable visit buffer: rows land here before the 200 response, deleted once
// the capture pipeline commits to webpage_activity_sessions. Lives inside the
// encrypted metadata store so visits-in-flight are never plaintext on disk.
export const VISIT_INBOX_TABLE = "visit_inbox";

/**
 * Capture metadata columns selected (aliased `cap_*`) when a tree query joins
 * `webpage_capture c`. Mapped to a {@link PageCapture} by
 * {@link row_to_page_activity_session_with_meta}.
 */
const CAPTURE_SELECT = [
  "c.title as cap_title",
  "c.content_type as cap_content_type",
  "c.captured_at as cap_captured_at",
].join(",\n         ");

/**
 * Generic encrypted single-file DuckDB store. The wrapper only opens (and
 * closes) the store — a file-backed database is only ever created encrypted —
 * and exposes query helpers; the schema is the store owner's contract, created
 * explicitly after init ({@link create_metadata_schema} for the metadata
 * store, `create_content_cache_schema` for the content cache).
 *
 * @example
 * ```typescript
 * const db = new DuckDB({
 *   database_path: './webpages.db',
 *   encryption_key: key_from_secret_storage,
 * });
 * await db.init();
 * await create_metadata_schema(db);
 *
 * const sessions = await db.query<PageActivitySession>(
 *   'SELECT * FROM webpage_activity_sessions WHERE url LIKE $url_pattern',
 *   { url_pattern: '%example.com%' }
 * );
 *
 * await db.close();
 * ```
 */
export class DuckDB {
  private db: DuckDBInstance;
  public connection: DuckDBConnection;
  private readonly target: StoreTarget;

  /**
   * Creates a new DuckDB instance with the specified configuration.
   * The database file is opened if it exists and created if it does not;
   * existing data is preserved across instantiations.
   *
   * @param config - Database configuration options
   *
   * @example
   * ```typescript
   * const db = new DuckDB({
   *   database_path: './my-database.db',
   *   encryption_key: key_from_secret_storage,
   * });
   * ```
   */
  constructor(config: DuckDBConfig) {
    if (config.database_path === ":memory:") {
      if (config.encryption_key !== undefined) {
        throw new Error(
          "An in-memory DuckDB database never touches disk and takes no encryption key"
        );
      }
      this.target = { in_memory: true };
      return;
    }
    if (!config.encryption_key) {
      throw new Error(
        "A file-backed DuckDB store requires an encryption_key — it is only ever created encrypted (no plaintext fallback)"
      );
    }
    // Hex-only keys make the ATTACH statement structurally inert (a malformed
    // key cannot produce a parser error that echoes key material into logs)
    // and reject weak operator-supplied keys on the env-sourced path.
    if (!/^[0-9a-f]{64}$/.test(config.encryption_key)) {
      throw new Error(
        "encryption_key must be 64 lowercase hex characters (32 random bytes)"
      );
    }
    this.target = {
      in_memory: false,
      database_path: config.database_path,
      encryption_key: config.encryption_key,
    };
    // Ensure the parent directory exists so the database file can be created.
    const dir = path.dirname(config.database_path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Opens the database. The schema is the caller's contract, created
   * explicitly after init — {@link create_metadata_schema} for the metadata
   * store, `create_content_cache_schema` for the content cache.
   *
   * @returns Promise that resolves when the store is open
   * @throws {Error} If the store cannot be opened (e.g. wrong encryption key)
   *
   * @example
   * ```typescript
   * const db = new DuckDB({
   *   database_path: './webpages.db',
   *   encryption_key: key_from_secret_storage,
   * });
   * await db.init();
   * await create_metadata_schema(db);
   * // Database is now ready for use
   * ```
   */
  async init(): Promise<void> {
    // The instance itself is always in-memory; a file-backed store is attached
    // with DuckDB native encryption so the file is only ever created (and
    // opened) encrypted. Opening it without the key, or with the wrong key,
    // fails — there is no plaintext path.
    this.db = await DuckDBInstance.create(":memory:");
    this.connection = await this.db.connect();

    try {
      await this.open_target_store();
    } catch (error) {
      // A half-open instance (e.g. wrong key at ATTACH) would otherwise leak
      // native resources for the life of the host process.
      await this.close();
      throw error;
    }
  }

  /**
   * Attaches the encrypted file store (no-op for `:memory:`). The attach is
   * the only path that touches disk, and it always carries the encryption
   * key. Temp-file settings close the remaining plaintext spill channel:
   * DuckDB encrypts the database file and WAL of an encrypted database, but
   * memory-pressure spill files are encrypted only when
   * `temp_file_encryption` is on, and they default to a cwd-relative `.tmp`
   * directory — both are pinned here so no store data can reach disk
   * unencrypted or outside the store's own directory.
   */
  private async open_target_store(): Promise<void> {
    const target = this.target;
    if (target.in_memory === true) {
      return;
    }
    // The key is validated hex and the path is escaped; nothing logs this
    // statement. Embedding the key in SQL text is the only mechanism ATTACH
    // offers (options take no bound parameters) and is accepted under the
    // threat model (a process that can read our SQL can read the keystore).
    await this.connection.run(
      `ATTACH ${sql_string_literal(target.database_path)}
       AS ${STORE_ALIAS}
       (ENCRYPTION_KEY ${sql_string_literal(target.encryption_key)})`
    );
    await this.connection.run(`USE ${STORE_ALIAS}`);
    await this.connection.run(`SET temp_file_encryption = true`);
    await this.connection.run(
      `SET temp_directory = ${sql_string_literal(`${target.database_path}.tmp`)}`
    );
  }


  /**
   * Executes a SQL query and returns all matching results.
   *
   * @template T - Expected type of the result rows
   * @param sql - SQL query string with optional parameter placeholders ($param_name)
   * @param params - Named parameters for the SQL query (default: {})
   * @returns Promise that resolves to array of result rows
   * @throws {Error} If query execution fails
   *
   * @example
   * ```typescript
   * const sessions = await db.query<PageActivitySession>(
   *   'SELECT * FROM webpage_activity_sessions WHERE tree_id = $tree_id',
   *   { tree_id: 'abc123' }
   * );
   * ```
   */
  async query<T>(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<T[]> {
    const result = await this.connection.runAndReadAll(sql, params);
    return result.getRowObjects() as T[];
  }

  /**
   * Executes a SQL query and returns only the first matching result.
   *
   * @template T - Expected type of the result row
   * @param sql - SQL query string with optional parameter placeholders
   * @param params - Named parameters for the SQL query (default: {})
   * @returns Promise that resolves to first result row or null if no matches
   * @throws {Error} If query execution fails
   *
   * @example
   * ```typescript
   * const session = await db.query_first<PageActivitySession>(
   *   'SELECT * FROM webpage_activity_sessions WHERE id = $id',
   *   { id: 'session-123' }
   * );
   * ```
   */
  async query_first<T>(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Executes a SQL command that doesn't return results (INSERT, UPDATE, DELETE, etc.).
   *
   * @param sql - SQL command string with optional parameter placeholders
   * @param params - Named parameters for the SQL command (default: {})
   * @returns Promise that resolves when command completes
   * @throws {Error} If command execution fails
   *
   * @example
   * ```typescript
   * await db.execute(
   *   'INSERT INTO webpage_activity_sessions (id, url) VALUES ($id, $url)',
   *   { id: 'session-123', url: 'https://example.com' }
   * );
   * ```
   */
  async execute(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<void> {
    await this.connection.run(sql, params);
  }

  /**
   * Creates a table with the specified schema if it doesn't already exist.
   *
   * @param table_name - Name of the table to create
   * @param schema - SQL column definitions for the table
   * @returns Promise that resolves when table is created
   * @throws {Error} If table creation fails
   *
   * @example
   * ```typescript
   * await db.create_table('my_table', 'id TEXT PRIMARY KEY, name TEXT NOT NULL');
   * ```
   */
  async create_table(table_name: string, schema: string): Promise<void> {
    const sql = `CREATE TABLE IF NOT EXISTS ${table_name} (${schema})`;
    try {
      console.log("Executing SQL:", sql);
      await this.connection.run(sql);
    } catch (error) {
      console.error(`Error creating table ${table_name}:`, error);
      throw error;
    }
  }

  /**
   * Runs `fn` inside one transaction on a DEDICATED connection to the same
   * store, so concurrent statements on the shared main connection (e.g. the
   * live visit writer) never join — or get rolled back with — the
   * transaction. Commits when `fn` resolves, rolls back when it throws, and
   * always disconnects the dedicated connection.
   */
  async isolated_transaction(
    fn: (
      run: (sql: string, params?: Record<string, DuckDBValue>) => Promise<void>
    ) => Promise<void>
  ): Promise<void> {
    const connection = await this.db.connect();
    const run = async (
      sql: string,
      params: Record<string, DuckDBValue> = {}
    ): Promise<void> => {
      await connection.run(sql, params);
    };
    try {
      if (this.target.in_memory === false) {
        // The default catalog is per-connection; point the fresh connection
        // at the attached store like init() does for the main one.
        await run(`USE ${STORE_ALIAS}`);
      }
      await run("BEGIN TRANSACTION");
      try {
        await fn(run);
        await run("COMMIT");
      } catch (error) {
        await run("ROLLBACK");
        throw error;
      }
    } finally {
      connection.disconnectSync();
    }
  }

  /**
   * Closes the connection and the instance, checkpointing the attached store
   * (the WAL is folded into the encrypted database file). Safe to call on an
   * uninitialized or partially-initialized wrapper (no-op for what never
   * opened).
   *
   * @returns Promise that resolves when the database is closed
   *
   * @example
   * ```typescript
   * await db.close();
   * ```
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.disconnectSync();
    }
    if (this.db) {
      this.db.closeSync();
    }
  }

  /**
   * Executes a SQL command without parameters (legacy compatibility method).
   *
   * @param sql - SQL command string
   * @returns Promise that resolves when command completes
   * @throws {Error} If command execution fails
   *
   * @example
   * ```typescript
   * await db.exec('CREATE INDEX IF NOT EXISTS idx_url ON webpage_activity_sessions(url)');
   * ```
   */
  async exec(sql: string): Promise<void> {
    await this.connection.run(sql);
  }

  private convert_params_to_duck_db_format(
    sql: string,
    params: unknown[]
  ): { sql: string; param_obj: Record<string, DuckDBValue> } {
    if (params.length === 0) {
      return { sql, param_obj: {} };
    }

    const param_obj: Record<string, DuckDBValue> = {};
    let param_index = 0;

    // Replace ? with $1, $2, etc.
    const modified_sql = sql.replace(/\?/g, () => {
      param_index++;
      return `$${param_index}`;
    });

    // Build parameter object
    params.forEach((value, index) => {
      param_obj[`${index + 1}`] = value as DuckDBValue;
    });

    return { sql: modified_sql, param_obj };
  }

  /**
   * Executes a SQL command with positional parameters (? placeholders).
   * Parameters are automatically converted to named parameters for DuckDB.
   *
   * @param sql - SQL command string with ? placeholders
   * @param params - Array of parameter values in order (default: [])
   * @returns Promise that resolves when command completes
   * @throws {Error} If command execution fails
   *
   * @example
   * ```typescript
   * await db.run(
   *   'INSERT INTO webpage_activity_sessions (id, url) VALUES (?, ?)',
   *   ['session-123', 'https://example.com']
   * );
   * ```
   */
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (params.length === 0) {
      await this.connection.run(sql);
      return;
    }
    const { sql: modified_sql, param_obj } =
      this.convert_params_to_duck_db_format(sql, params);
    await this.connection.run(modified_sql, param_obj);
  }

  /**
   * Executes a SQL query with positional parameters and returns all results.
   * Parameters are automatically converted to named parameters for DuckDB.
   *
   * @template T - Expected type of the result rows (default: unknown)
   * @param sql - SQL query string with ? placeholders
   * @param params - Array of parameter values in order (default: [])
   * @returns Promise that resolves to array of result rows
   * @throws {Error} If query execution fails
   *
   * @example
   * ```typescript
   * const sessions = await db.all<PageActivitySession>(
   *   'SELECT * FROM webpage_activity_sessions WHERE url LIKE ?',
   *   ['%example.com%']
   * );
   * ```
   */
  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (params.length === 0) {
      const result = await this.connection.runAndReadAll(sql);
      return result.getRowObjects() as T[];
    }
    const { sql: modified_sql, param_obj } =
      this.convert_params_to_duck_db_format(sql, params);
    const result = await this.connection.runAndReadAll(modified_sql, param_obj);
    return result.getRowObjects() as T[];
  }

  /**
   * Executes a SQL query with positional parameters and returns the first result.
   * Parameters are automatically converted to named parameters for DuckDB.
   *
   * @template T - Expected type of the result row (default: unknown)
   * @param sql - SQL query string with ? placeholders
   * @param params - Array of parameter values in order (default: [])
   * @returns Promise that resolves to first result row or null if no matches
   * @throws {Error} If query execution fails
   *
   * @example
   * ```typescript
   * const session = await db.get<PageActivitySession>(
   *   'SELECT * FROM webpage_activity_sessions WHERE id = ?',
   *   ['session-123']
   * );
   * ```
   */
  async get<T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const results = await this.all<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }
}

/**
 * A row in {@link WEBPAGE_CAPTURE_TABLE}: browsing metadata only. The page's
 * title is captured from the browser tab; content is never stored here.
 */
export type WebpageCaptureRecord = PageCapture;

/**
 * Inserts (or replaces) a capture's browsing metadata. No page content is
 * stored — content and `<meta>`-derived fields come from re-download.
 */
export async function insert_webpage_capture(
  db: DuckDB,
  capture: WebpageCaptureRecord
): Promise<void> {
  const params: Record<string, DuckDBValue> = {
    page_session_id: capture.page_session_id,
    url: capture.url,
    title: capture.title,
    content_type: capture.content_type,
    captured_at: capture.captured_at,
  };
  // Upsert: a re-captured page (deterministic id) overwrites the prior capture.
  await db.execute(
    `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
      (page_session_id, url, title, content_type, captured_at)
     VALUES ($page_session_id, $url, $title, $content_type, $captured_at)
     ON CONFLICT (page_session_id) DO UPDATE SET
       url = excluded.url,
       title = excluded.title,
       content_type = excluded.content_type,
       captured_at = excluded.captured_at`,
    params
  );
}

/** Reads the capture metadata for a page session, or null. */
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

/** Columns of {@link WEBPAGE_FETCH_TABLE}, in insert/select order. */
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
 * Appends one re-download fetch record (outcome + fidelity + parsed `<meta>`).
 * The row is keyed by a deterministic `fetch_id` derived from page_session_id,
 * fetched_at, outcome, and content_hash. An identical replay of the same attempt
 * is idempotent (ON CONFLICT DO NOTHING), while two genuinely distinct fetches
 * that happen to share a millisecond differ in outcome or content hash and so
 * each append a row, preserving drift history.
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
 * Lists every stored capture's `page_session_id` and `url` — the fetch targets
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

/**
 * Reads the most recent re-download fetch record for a page session, or null —
 * the fidelity/drift lookup over the append-only {@link WEBPAGE_FETCH_TABLE} log.
 * The content read path does not consult this (it always re-downloads live);
 * consumers that need repeated content reads opt into the encrypted content
 * cache (`redownload/cached_corpus.ts`).
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

/**
 * Inserts a page activity session into the database.
 * Returns whether this was a new session or an update to an existing one.
 *
 * @param db - DuckDB instance to insert into
 * @param session - Page activity session data (before tree assignment)
 * @returns Promise resolving to whether the session row was newly created
 *   (`was_new_session`) and whether its tree assignment changed (`tree_changed`,
 *   true for a new row or when an existing row is moved to a different tree).
 * @throws {Error} If insertion fails
 *
 * @example
 * ```typescript
 * const result = await insert_page_activity_session(db, {
 *   id: 'session-123',
 *   url: 'https://example.com',
 *   referrer: 'https://google.com',
 *   page_loaded_at: '2024-01-01T12:00:00Z',
 *   tree_id: 'tree-456'
 * });
 * console.log('New session?', result.was_new_session);
 * ```
 */
export async function insert_page_activity_session(
  db: DuckDB,
  session: PageActivitySession
): Promise<{ was_new_session: boolean; tree_changed: boolean }> {
  try {
    // Check if the session already exists, capturing its current tree so we can
    // tell whether this call moves it to a different tree (e.g. a previously
    // orphaned page being re-linked to its parent once the parent arrives).
    const existing_session = await db.connection.runAndReadAll(
      `SELECT tree_id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} WHERE id = $id`,
      { id: session.id }
    );

    const existing_rows = existing_session.getRowObjects();
    const was_new_session = existing_rows.length === 0;
    const tree_changed =
      was_new_session || existing_rows[0].tree_id !== session.tree_id;

    if (was_new_session) {
      // Insert new session
      await db.execute(
        `INSERT INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} 
        (
          id, 
          url, 
          referrer,
          referrer_page_session_id,
          page_loaded_at, 
          tree_id
        )
        VALUES 
        (
          $id, 
          $url, 
          $referrer,
          $referrer_page_session_id,
          $page_loaded_at, 
          $tree_id
        )`,
        {
          id: session.id,
          url: session.url,
          referrer: session.referrer,
          referrer_page_session_id: session.referrer_page_session_id ?? null,
          page_loaded_at: session.page_loaded_at,
          tree_id: session.tree_id,
        }
      );
    } else {
      // Update existing session
      await db.execute(
        `UPDATE ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
        SET 
          url = $url,
          referrer = $referrer,
          referrer_page_session_id = $referrer_page_session_id,
          page_loaded_at = $page_loaded_at,
          tree_id = $tree_id
        WHERE id = $id`,
        {
          id: session.id,
          url: session.url,
          referrer: session.referrer,
          referrer_page_session_id: session.referrer_page_session_id ?? null,
          page_loaded_at: session.page_loaded_at,
          tree_id: session.tree_id,
        }
      );
    }

    return { was_new_session, tree_changed };
  } catch (error) {
    console.error("Error inserting page activity session:", error);
    throw error;
  }
}

/**
 * Finds a navigation tree that contains the specified URL.
 * Uses fuzzy matching to handle referrer policy truncation (matches URLs that start with referrer).
 * Returns the closest matching session by timestamp.
 *
 * @param db - DuckDB instance to query from
 * @param referrer_url - URL to search for in existing sessions
 * @param new_page_visited_at - Timestamp of the new page visit (for proximity matching)
 * @returns Promise that resolves to closest matching PageActivitySession or null if none found
 * @throws {Error} If query fails
 *
 * @example
 * ```typescript
 * const parentSession = await find_tree_containing_url(
 *   db,
 *   'https://example.com',
 *   '2024-01-01T12:00:00Z'
 * );
 * if (parentSession) {
 *   console.log('Found parent tree:', parentSession.tree_id);
 * }
 * ```
 */
export async function find_tree_containing_url(
  db: DuckDB,
  referrer_url: string,
  new_page_visited_at: string
): Promise<PageActivitySession | null> {
  try {
    // Due to referrer policy (strict-origin-when-cross-origin), cross-origin referrers
    // are truncated to just the origin (e.g., https://www.google.com/search?q=foo becomes https://www.google.com/)
    // So we need to match URLs that start with the referrer URL
    const new_page_timestamp = new_page_visited_at;
    const result = await db.connection.runAndReadAll(
      `SELECT *
       FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} 
       WHERE url LIKE $referrer_pattern
       ORDER BY ABS(EPOCH(CAST($new_page_timestamp AS TIMESTAMP)) - EPOCH(CAST(page_loaded_at AS TIMESTAMP))) ASC
       LIMIT 1`,
      {
        referrer_pattern: `${referrer_url}%`,
        new_page_timestamp: new_page_timestamp,
      }
    );

    const rows = result.getRowObjects();
    return rows.length > 0 ? row_to_page_activity_session(rows[0]) : null;
  } catch (error) {
    console.error("Error finding tree containing URL:", error);
    throw error;
  }
}

/**
 * Retrieves all page sessions belonging to a specific navigation tree, joined to
 * their capture metadata (title etc.) where present.
 *
 * @param db - DuckDB instance to query from
 * @param tree_id - ID of the navigation tree to retrieve sessions for
 * @returns Promise that resolves to array of PageActivitySessionWithMeta objects
 * @throws {Error} If the query fails
 *
 * @example
 * ```typescript
 * const treeMembers = await get_page_sessions_with_tree_id(db, 'tree-123');
 * console.log(`Tree has ${treeMembers.length} page sessions`);
 * ```
 */
export async function get_page_sessions_with_tree_id(
  db: DuckDB,
  tree_id: string
): Promise<PageActivitySessionWithMeta[]> {
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT
         s.*,
         ${CAPTURE_SELECT}
       FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
       LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
       WHERE s.tree_id = $tree_id`,
      { tree_id }
    );

    return result.getRowObjects().map(row_to_page_activity_session_with_meta);
  } catch (error) {
    console.error("Error getting page sessions with tree ID:", error);
    throw error;
  }
}

function row_to_page_activity_session(
  row: Record<string, DuckDBValue>
): PageActivitySession {
  return PageActivitySessionSchema.parse({
    id: row.id.toString(),
    url: row.url.toString(),
    referrer: row.referrer ? row.referrer.toString() : null,
    referrer_page_session_id: row.referrer_page_session_id
      ? row.referrer_page_session_id.toString()
      : null,
    page_loaded_at: row.page_loaded_at.toString(),
    tree_id: row.tree_id.toString(),
  });
}

/**
 * Inserts a new webpage navigation tree record.
 *
 * @param db - DuckDB instance to insert into
 * @param tree_id - Unique identifier for the navigation tree
 * @param first_load_time - ISO timestamp of the first page load in this tree
 * @param latest_activity_time - ISO timestamp of the most recent activity in this tree
 * @returns Promise that resolves when the tree is inserted
 * @throws {Error} If insertion fails
 *
 * @example
 * ```typescript
 * await insert_webpage_tree(
 *   db,
 *   'tree-123',
 *   '2024-01-01T12:00:00Z',
 *   '2024-01-01T12:30:00Z'
 * );
 * ```
 */
export async function insert_webpage_tree(
  db: DuckDB,
  tree_id: string,
  first_load_time: string,
  latest_activity_time: string
): Promise<void> {
  try {
    // First check if tree exists to avoid foreign key constraint issues with REPLACE
    const existing = await db.query_first(
      `SELECT id FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: tree_id }
    );
    
    if (existing) {
      // Tree already exists, just update the activity time if needed
      await db.execute(
        `UPDATE ${WEBPAGE_TREES_TABLE} 
        SET latest_activity_time = $latest_activity_time
        WHERE id = $id AND latest_activity_time < $latest_activity_time`,
        {
          id: tree_id,
          latest_activity_time,
        }
      );
    } else {
      // Tree doesn't exist, insert it
      await db.execute(
        `INSERT INTO ${WEBPAGE_TREES_TABLE} 
        (id, first_load_time, latest_activity_time)
        VALUES ($id, $first_load_time, $latest_activity_time)`,
        {
          id: tree_id,
          first_load_time,
          latest_activity_time,
        }
      );
    }
  } catch (error) {
    console.error("Error inserting webpage tree:", error);
    throw error;
  }
}

/**
 * Updates the latest activity time for a webpage navigation tree.
 *
 * @param db - DuckDB instance to update in
 * @param tree_id - ID of the tree to update
 * @param latest_activity_time - New latest activity timestamp
 * @returns Promise that resolves when the update is complete
 * @throws {Error} If update fails
 *
 * @example
 * ```typescript
 * await update_webpage_tree_activity_time(
 *   db,
 *   'tree-123',
 *   '2024-01-01T13:00:00Z'
 * );
 * ```
 */
export async function update_webpage_tree_activity_time(
  db: DuckDB,
  tree_id: string,
  latest_activity_time: string
): Promise<void> {
  try {
    // Check if tree exists first
    const existing = await db.query_first<{ id: string; latest_activity_time: string }>(
      `SELECT id, latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: tree_id }
    );
    
    if (!existing) {
      console.warn(`Tree ${tree_id} does not exist, skipping update`);
      return;
    }
    
    // Only update if the new time is actually later
    if (existing.latest_activity_time >= latest_activity_time) {
      return;
    }

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
      console.warn("Skipping tree update due to DuckDB foreign key handling:", message);
      return;
    }
    console.error("Error updating webpage tree activity time:", error);
    throw error;
  }
}

/**
 * Retrieves the most recently modified navigation trees with all their member
 * sessions, joined to their capture metadata where present.
 *
 * @param db - DuckDB instance to query from
 * @param table_id_to_exclude - Tree ID to exclude from results (usually current tree)
 * @param limit - Maximum number of trees to return (default: 5)
 * @returns Promise that resolves to mapping of tree IDs to their member sessions
 * @throws {Error} If the query fails
 *
 * @example
 * ```typescript
 * const recentTrees = await get_last_modified_trees_with_members(
 *   db,
 *   'current-tree-id',
 *   3
 * );
 * Object.keys(recentTrees).forEach(treeId => {
 *   console.log(`Tree ${treeId} has ${recentTrees[treeId].length} sessions`);
 * });
 * ```
 */
export async function get_last_modified_trees_with_members(
  db: DuckDB,
  table_id_to_exclude: string,
  limit = 5
): Promise<Record<string, PageActivitySessionWithMeta[]>> {
  // N.B. this could order by recency to a given time but so far this is only used for processing the most recent trees
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT
         s.*,
         ${CAPTURE_SELECT}
       FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
       LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
       WHERE s.tree_id IN (
         SELECT id
         FROM ${WEBPAGE_TREES_TABLE}
         WHERE id != $table_id_to_exclude
         ORDER BY latest_activity_time DESC
         LIMIT $limit
       )
       ORDER BY s.tree_id, s.page_loaded_at ASC`,
      { limit, table_id_to_exclude }
    );

    const all_tree_members = result
      .getRowObjects()
      .map(row_to_page_activity_session_with_meta);
    return all_tree_members.reduce((acc, member) => {
      const tree_id = member.tree_id;
      if (!acc[tree_id]) {
        acc[tree_id] = [];
      }
      acc[tree_id].push(member);
      return acc;
    }, {} as Record<string, PageActivitySessionWithMeta[]>);
  } catch (error) {
    console.error("Error getting last modified trees with members:", error);
    throw error;
  }
}

/**
 * Updates an existing page activity session with new tree and referrer information.
 *
 * @param db - DuckDB instance to update in
 * @param session - Updated session data with new tree_id and referrer information
 * @returns Promise that resolves when the update is complete
 * @throws {Error} If update fails
 *
 * @example
 * ```typescript
 * await update_page_activity_session(db, {
 *   ...existingSession,
 *   tree_id: 'new-tree-id',
 *   referrer_page_session_id: 'parent-session-id'
 * });
 * ```
 */
export async function update_page_activity_session(
  db: DuckDB,
  session: PageActivitySession
): Promise<void> {
  await db.connection.run(
    `UPDATE webpage_activity_sessions 
     SET tree_id = $tree_id, referrer_page_session_id = $referrer_page_session_id
     WHERE id = $id`,
    {
      tree_id: session.tree_id,
      referrer_page_session_id: session.referrer_page_session_id,
      id: session.id,
    }
  );
}

function row_to_page_activity_session_with_meta(
  row: Record<string, DuckDBValue>
): PageActivitySessionWithMeta {
  const base_session = row_to_page_activity_session(row);

  // A capture row is present iff its (NOT NULL) title joined through. When
  // present, the other NOT NULL columns (content_type / captured_at) are
  // guaranteed non-null, so they are read directly.
  const capture_exists =
    row.cap_title !== null && row.cap_title !== undefined;
  const capture: PageCapture | undefined = capture_exists
    ? {
        page_session_id: base_session.id,
        url: base_session.url,
        title: row.cap_title.toString(),
        content_type: row.cap_content_type.toString(),
        captured_at: row.cap_captured_at.toString(),
      }
    : undefined;

  return PageActivitySessionWithMetaSchema.parse({
    ...base_session,
    capture,
  });
}

/**
 * Retrieves a captured page by its exact title (metadata only; the raw bytes are
 * read on demand via the capture store). Returns null if no capture matches.
 *
 * @param db - DuckDB instance to query from
 * @param title - Exact title of the page to retrieve
 */
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

/**
 * Retrieves webpage information by URL, returning the most recent visit.
 *
 * @param db - DuckDB instance to query from
 * @param url - Exact URL to search for
 * @returns Promise that resolves to webpage info object or null if not found
 * @throws {Error} If query fails
 *
 * @example
 * ```typescript
 * const webpage = await get_webpage_by_url(db, 'https://example.com/article');
 * if (webpage) {
 *   console.log(`Page: ${webpage.title}`);
 *   console.log(`Last visited: ${webpage.visited_at}`);
 * }
 * ```
 */
export async function get_webpage_by_url(
  db: DuckDB,
  url: string
): Promise<{ url: string; title: string; visited_at: string } | null> {
  try {
    const result = await db.connection.runAndReadAll(
      `
      SELECT
        s.url,
        COALESCE(c.title, '') as title,
        s.page_loaded_at as visited_at
      FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
      LEFT JOIN ${WEBPAGE_CAPTURE_TABLE} c ON s.id = c.page_session_id
      WHERE s.url = $url
      ORDER BY s.page_loaded_at DESC
      LIMIT 1
      `,
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
  } catch (error) {
    console.error("Error getting webpage by URL:", error);
    throw error;
  }
}

/**
 * Creates the metadata-store tables and indexes (idempotent). Called once
 * after {@link DuckDB.init} by the owner of the metadata store; the content
 * cache (a separate encrypted store) has its own schema.
 */
export async function create_metadata_schema(db: DuckDB): Promise<void> {
  const webpage_trees_schema = [
    "id TEXT PRIMARY KEY", // hash of the root page session ID + its load time
    "latest_activity_time TEXT", // ISO timestamp of the last activity in this tree
    "first_load_time TEXT", // ISO timestamp of the first page load in this tree
  ].join(", ");
  await db.create_table(WEBPAGE_TREES_TABLE, webpage_trees_schema);

  const activity_sessions_schema = [
    "id TEXT PRIMARY KEY", // hash of url + timestamp
    "url TEXT NOT NULL",
    "referrer TEXT",
    "referrer_page_session_id TEXT", // ID of the referrer page session, if any
    "page_loaded_at TEXT", // ISO timestamp string when the page was loaded
    `tree_id TEXT NOT NULL REFERENCES ${WEBPAGE_TREES_TABLE}(id)`, // ID of the navigation tree this session belongs to
  ].join(", ");
  await db.create_table(WEBPAGE_ACTIVITY_SESSIONS_TABLE, activity_sessions_schema);

  // Capture metadata store, keyed by page_session_id (no foreign key, so a
  // capture can be written before or independently of the activity-session row).
  // This holds browsing metadata only — page content is never stored here. The
  // authoritative content path is RE-DOWNLOAD (src/redownload/): content, and
  // the `<meta>`-derived fields (author / site_name / published_at / lang), are
  // obtained by re-fetching the public URL and logged to `webpage_fetch`.
  const webpage_capture_schema = [
    "page_session_id TEXT PRIMARY KEY", // hash of url + timestamp
    "url TEXT NOT NULL",
    "title TEXT NOT NULL", // page title, captured from the browser tab
    "content_type TEXT NOT NULL", // MIME type of the captured page
    "captured_at TEXT NOT NULL", // ISO timestamp when the page was captured
  ].join(", ");
  await db.create_table(WEBPAGE_CAPTURE_TABLE, webpage_capture_schema);

  // Re-download fidelity log: one row per post-processing fetch of a stored
  // URL. Records the outcome classification, fidelity (fetched_at, http_status,
  // content hash), and the <meta>-derived fields parsed from the re-downloaded
  // page. Append-only so content drift and unavailability stay visible over
  // time. Holds NO page content — re-downloaded bytes are served on demand; the
  // encrypted on-demand content cache is a separate tier (redownload/content_cache.ts).
  const webpage_fetch_schema = [
    "fetch_id TEXT PRIMARY KEY", // hash of page_session_id + fetched_at
    "page_session_id TEXT NOT NULL", // metadata row this fetch serves (no FK)
    "url TEXT NOT NULL", // the stored public URL that was re-downloaded
    "final_url TEXT", // url after redirects; null if unresolved
    "outcome TEXT NOT NULL", // ok|auth_redirect|forbidden|paywall|dead_link|non_html
    "http_status INTEGER", // final status; null on transport failure
    "content_hash TEXT", // sha-256 hex of re-downloaded content; null if excluded
    "content_type TEXT", // MIME of the re-downloaded response
    "author TEXT", // <meta> fields parsed from the re-download
    "published_at TEXT",
    "lang TEXT",
    "site_name TEXT",
    "fetched_at TEXT NOT NULL", // ISO timestamp of the fetch attempt
  ].join(", ");
  await db.create_table(WEBPAGE_FETCH_TABLE, webpage_fetch_schema);

  // Durable visit inbox — transient rows written before the 200 response,
  // deleted once the capture pipeline commits. Keyed by visit id; url and
  // page_loaded_at are exposed for the right-to-forget selector sweep.
  const visit_inbox_schema = [
    "id TEXT PRIMARY KEY",       // visit.id (hash of url + timestamp)
    "url TEXT NOT NULL",         // for forget cascade selector matching
    "page_loaded_at TEXT",       // for time-range selector matching
    "visit_json TEXT NOT NULL",  // full JSON of ExtendedPageVisit for reload
  ].join(", ");
  await db.create_table(VISIT_INBOX_TABLE, visit_inbox_schema);

  // Indexes for the common query patterns over the metadata tables.
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_url
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(url)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_tree_id
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(tree_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_referrer
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(referrer_page_session_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_loaded_at
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(page_loaded_at)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_trees_latest_activity
                 ON ${WEBPAGE_TREES_TABLE}(latest_activity_time)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_capture_title
                 ON ${WEBPAGE_CAPTURE_TABLE}(title)`);
}
