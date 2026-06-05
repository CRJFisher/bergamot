import {
  DuckDBInstance,
  DuckDBConnection,
  DuckDBValue,
  DuckDBBlobValue,
  blobValue,
} from "@duckdb/node-api";
import * as path from "path";
import * as fs from "fs";
import {
  PageCapture,
  PageActivitySessionWithMeta,
  PageActivitySessionWithMetaSchema,
} from "./page_capture_models";
import {
  PageActivitySession,
  PageActivitySessionSchema,
  PageActivitySessionWithoutContent,
} from "./duck_db_models";

/**
 * Configuration options for DuckDB database connection
 * @interface DuckDBConfig
 */
export interface DuckDBConfig {
  /** File system path where the database will be stored */
  database_path: string;
  /** Whether to open the database in read-only mode (default: false) */
  read_only?: boolean;
}

const WEBPAGE_ACTIVITY_SESSIONS_TABLE = "webpage_activity_sessions";
const WEBPAGE_TREES_TABLE = "webpage_trees";
const WEBPAGE_CAPTURE_TABLE = "webpage_capture";

/**
 * Capture metadata columns selected (aliased `cap_*`) when a tree query joins
 * `webpage_capture c`. Mapped to a {@link PageCapture} by
 * {@link row_to_page_activity_session_with_meta}.
 */
const CAPTURE_SELECT = [
  "c.title as cap_title",
  "c.site_name as cap_site_name",
  "c.author as cap_author",
  "c.published_at as cap_published_at",
  "c.lang as cap_lang",
  "c.content_type as cap_content_type",
  "c.captured_at as cap_captured_at",
  "c.original_byte_size as cap_original_byte_size",
].join(",\n         ");

/**
 * DuckDB database wrapper for the capture pipeline. Manages tables for webpage
 * activity sessions, navigation trees, and raw-page captures.
 *
 * @example
 * ```typescript
 * const db = new DuckDB({ database_path: './webpages.db' });
 * await db.init();
 *
 * // Query for webpage sessions
 * const sessions = await db.query<PageActivitySession>(
 *   'SELECT * FROM webpage_activity_sessions WHERE url LIKE ?',
 *   { url_pattern: '%example.com%' }
 * );
 *
 * await db.close();
 * ```
 */
export class DuckDB {
  private db: DuckDBInstance;
  public connection: DuckDBConnection;
  private config: DuckDBConfig;

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
   *   read_only: false
   * });
   * ```
   */
  constructor(config: DuckDBConfig) {
    this.config = config;
    // Ensure the parent directory exists so the database file can be created.
    const dir = path.dirname(config.database_path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initializes the database connection and creates required tables.
   * Creates the following tables:
   * - webpage_trees: Navigation tree metadata
   * - webpage_activity_sessions: Individual page visit records
   * - webpage_capture: Raw captured pages (zstd) plus cheap metadata
   *
   * @returns Promise that resolves when initialization is complete
   * @throws {Error} If database connection or table creation fails
   *
   * @example
   * ```typescript
   * const db = new DuckDB({ database_path: './webpages.db' });
   * await db.init();
   * // Database is now ready for use
   * ```
   */
  async init(): Promise<void> {
    const create_options = this.config.read_only
      ? { access_mode: "read_only" }
      : undefined;
    this.db = await DuckDBInstance.create(
      this.config.database_path,
      create_options
    );
    this.connection = await this.db.connect();

    if (this.config.read_only) {
      // Read-only connections cannot create tables or indexes; the schema is
      // expected to already exist (created by the read-write owner process).
      return;
    }

    const webpage_trees_schema = [
      "id TEXT PRIMARY KEY", // hash of the root page session ID + its load time
      "latest_activity_time TEXT", // ISO timestamp of the last activity in this tree
      "first_load_time TEXT", // ISO timestamp of the first page load in this tree
    ].join(", ");
    await this.create_table(WEBPAGE_TREES_TABLE, webpage_trees_schema);

    const activity_sessions_schema = [
      "id TEXT PRIMARY KEY", // hash of url + timestamp
      "url TEXT NOT NULL",
      "referrer TEXT",
      "referrer_page_session_id TEXT", // ID of the referrer page session, if any
      "page_loaded_at TEXT", // ISO timestamp string when the page was loaded
      `tree_id TEXT NOT NULL REFERENCES ${WEBPAGE_TREES_TABLE}(id)`, // ID of the navigation tree this session belongs to
    ].join(", ");
    await this.create_table(
      WEBPAGE_ACTIVITY_SESSIONS_TABLE,
      activity_sessions_schema
    );

    // Capture-first store: the raw page kept zstd-compressed as the durable,
    // lossless source of truth for downstream extraction/RAG, plus cheap
    // non-LLM metadata read from the <head>. Keyed by page_session_id but with
    // no foreign key, so a capture can be written before (or independently of)
    // the activity-session row.
    const webpage_capture_schema = [
      "page_session_id TEXT PRIMARY KEY", // hash of url + timestamp
      "content_compressed BLOB NOT NULL", // the raw page, zstd-compressed
      "content_encoding TEXT NOT NULL", // codec marker, e.g. 'zstd'
      "original_byte_size INTEGER NOT NULL", // decompressed page size in bytes
      "content_type TEXT NOT NULL", // MIME type of the captured page
      "url TEXT NOT NULL",
      "title TEXT NOT NULL",
      "site_name TEXT",
      "author TEXT",
      "published_at TEXT",
      "lang TEXT",
      "captured_at TEXT NOT NULL", // ISO timestamp when the page was captured
    ].join(", ");
    await this.create_table(WEBPAGE_CAPTURE_TABLE, webpage_capture_schema);

    // Performance optimization: Add database indexes for common queries
    await this.create_indexes();
  }

  /**
   * Creates database indexes to optimize common query patterns.
   * This significantly improves performance for frequently used queries.
   *
   * @returns Promise that resolves when all indexes are created
   * @throws {Error} If index creation fails
   */
  private async create_indexes(): Promise<void> {
    console.log("Creating database indexes for performance optimization...");

    try {
      // Index for URL lookups (common in tree finding operations)
      await this.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_url 
                      ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(url)`);

      // Index for tree_id lookups (critical for tree member queries)
      await this.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_tree_id 
                      ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(tree_id)`);

      // Index for referrer_page_session_id (used in orphan processing)
      await this
        .exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_referrer 
                      ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(referrer_page_session_id)`);

      // Index for page_loaded_at (used for time-based sorting and filtering)
      await this
        .exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_loaded_at 
                      ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(page_loaded_at)`);

      // Index for tree activity time lookups
      await this.exec(`CREATE INDEX IF NOT EXISTS idx_trees_latest_activity
                      ON ${WEBPAGE_TREES_TABLE}(latest_activity_time)`);

      // Index for capture title searches (used in get_page_by_title)
      await this.exec(`CREATE INDEX IF NOT EXISTS idx_capture_title
                      ON ${WEBPAGE_CAPTURE_TABLE}(title)`);

      console.log("✅ Database indexes created successfully");
    } catch (error) {
      console.error("Error creating database indexes:", error);
      throw error;
    }
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
   * Closes the database connection and releases resources.
   * Should be called when the database is no longer needed.
   *
   * @returns Promise that resolves when connection is closed
   *
   * @example
   * ```typescript
   * await db.close();
   * ```
   */
  async close(): Promise<void> {
    this.connection.disconnectSync();
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
 * A row in {@link WEBPAGE_CAPTURE_TABLE}: the {@link PageCapture} metadata plus
 * the raw page bytes. The compressed bytes are supplied by the caller
 * (zstd-compressed); metadata is read non-LLM from the page's `<head>`.
 */
export interface WebpageCaptureRecord extends PageCapture {
  /** The raw page, already zstd-compressed by the caller. */
  content_compressed: Uint8Array;
  /** Codec marker for {@link content_compressed} (e.g. `'zstd'`). */
  content_encoding: string;
}

/**
 * Inserts (or replaces) a raw-page capture. The page bytes are stored exactly as
 * supplied (zstd-compressed) so they round-trip losslessly; metadata columns
 * carry the cheap `<head>` signals for navigation/listing without decompression.
 */
export async function insert_webpage_capture(
  db: DuckDB,
  capture: WebpageCaptureRecord
): Promise<void> {
  const params: Record<string, DuckDBValue> = {
    page_session_id: capture.page_session_id,
    content_compressed: blobValue(capture.content_compressed),
    content_encoding: capture.content_encoding,
    original_byte_size: capture.original_byte_size,
    content_type: capture.content_type,
    url: capture.url,
    title: capture.title,
    site_name: capture.site_name,
    author: capture.author,
    published_at: capture.published_at,
    lang: capture.lang,
    captured_at: capture.captured_at,
  };
  // Upsert: a re-captured page (deterministic id) overwrites the prior capture.
  await db.execute(
    `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
      (page_session_id, content_compressed, content_encoding, original_byte_size,
       content_type, url, title, site_name, author, published_at, lang, captured_at)
     VALUES ($page_session_id, $content_compressed, $content_encoding, $original_byte_size,
       $content_type, $url, $title, $site_name, $author, $published_at, $lang, $captured_at)
     ON CONFLICT (page_session_id) DO UPDATE SET
       content_compressed = excluded.content_compressed,
       content_encoding = excluded.content_encoding,
       original_byte_size = excluded.original_byte_size,
       content_type = excluded.content_type,
       url = excluded.url,
       title = excluded.title,
       site_name = excluded.site_name,
       author = excluded.author,
       published_at = excluded.published_at,
       lang = excluded.lang,
       captured_at = excluded.captured_at`,
    params
  );
}

/** Reads the capture metadata for a page session (no raw bytes), or null. */
export async function get_webpage_capture(
  db: DuckDB,
  page_session_id: string
): Promise<PageCapture | null> {
  const row = await db.query_first<Record<string, DuckDBValue>>(
    `SELECT page_session_id, original_byte_size, content_type, url, title,
            site_name, author, published_at, lang, captured_at
     FROM ${WEBPAGE_CAPTURE_TABLE} WHERE page_session_id = $id`,
    { id: page_session_id }
  );
  if (!row) return null;
  return {
    page_session_id: row.page_session_id.toString(),
    original_byte_size: Number(row.original_byte_size),
    content_type: row.content_type.toString(),
    url: row.url.toString(),
    title: row.title.toString(),
    site_name: row.site_name ? row.site_name.toString() : null,
    author: row.author ? row.author.toString() : null,
    published_at: row.published_at ? row.published_at.toString() : null,
    lang: row.lang ? row.lang.toString() : null,
    captured_at: row.captured_at.toString(),
  };
}

/**
 * Reads the raw compressed page bytes for a page session. This is the
 * parent-document source for the RAG-prep pipeline (task-31.3): callers
 * decompress these bytes to recover the original page on demand.
 */
export async function get_webpage_capture_bytes(
  db: DuckDB,
  page_session_id: string
): Promise<Uint8Array | null> {
  const row = await db.query_first<{ content_compressed: DuckDBBlobValue | Uint8Array }>(
    `SELECT content_compressed FROM ${WEBPAGE_CAPTURE_TABLE} WHERE page_session_id = $id`,
    { id: page_session_id }
  );
  if (!row) return null;
  const value = row.content_compressed;
  // getRowObjects returns a BLOB column as a DuckDBBlobValue whose `.bytes` is
  // the raw Uint8Array; tolerate a plain Uint8Array defensively.
  return value instanceof Uint8Array ? value : value.bytes;
}

/**
 * Inserts a page activity session into the database.
 * Returns whether this was a new session or an update to an existing one.
 *
 * @param db - DuckDB instance to insert into
 * @param session - Page activity session data (without content field)
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
  session: PageActivitySessionWithoutContent
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
    content: "", // Content now stored in separate table
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
  // present, the other NOT NULL columns (content_type / captured_at /
  // original_byte_size) are guaranteed non-null, so they are read directly.
  const capture_exists =
    row.cap_title !== null && row.cap_title !== undefined;
  const capture: PageCapture | undefined = capture_exists
    ? {
        page_session_id: base_session.id,
        url: base_session.url,
        title: row.cap_title.toString(),
        site_name: row.cap_site_name ? row.cap_site_name.toString() : null,
        author: row.cap_author ? row.cap_author.toString() : null,
        published_at: row.cap_published_at
          ? row.cap_published_at.toString()
          : null,
        lang: row.cap_lang ? row.cap_lang.toString() : null,
        content_type: row.cap_content_type.toString(),
        captured_at: row.cap_captured_at.toString(),
        original_byte_size: Number(row.cap_original_byte_size),
      }
    : undefined;

  return PageActivitySessionWithMetaSchema.parse({
    ...base_session,
    content: "",
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
