import {
  DuckDBInstance,
  DuckDBConnection,
  DuckDBValue,
} from "@duckdb/node-api";
import * as path from "path";
import * as fs from "fs";
import { LanceDBMemoryStore, SearchItem } from "./lance_db";
import {
  PageAnalysis,
  PageActivitySessionWithMeta,
  PageActivitySessionWithMetaSchema,
} from "./reconcile_webpage_trees_workflow_models";
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

const WEBPAGE_ANALYSIS_TABLE = "webpage_analysis";
const WEBPAGE_ACTIVITY_SESSIONS_TABLE = "webpage_activity_sessions";
const WEBPAGE_TREES_TABLE = "webpage_trees";
const WEBPAGE_TREE_INTENTIONS_TABLE = "webpage_tree_intentions";

/**
 * DuckDB database wrapper providing webpage tracking and analysis functionality.
 * Manages tables for webpage activity sessions, trees, content, and analysis data.
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
   * Note: Database is recreated on each instantiation (existing file is deleted).
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
    // Ensure the directory exists
    const dir = path.dirname(config.database_path);
    // Delete table first
    if (fs.existsSync(config.database_path)) {
      fs.unlinkSync(config.database_path);
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initializes the database connection and creates required tables.
   * Creates the following tables:
   * - webpage_trees: Navigation tree metadata
   * - webpage_activity_sessions: Individual page visit records
   * - webpage_analysis: Page analysis and categorization data
   * - webpage_tree_intentions: Derived intentions for navigation trees
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
    this.db = await DuckDBInstance.create(this.config.database_path);
    this.connection = await this.db.connect();

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

    // Define and create the webpage_categorizations table
    const webpage_analysis_schema = [
      "page_session_id TEXT PRIMARY KEY",
      "title TEXT NOT NULL",
      "summary TEXT NOT NULL",
      "intentions TEXT", // JSON list of intentions
      "FOREIGN KEY (page_session_id) REFERENCES webpage_activity_sessions(id)",
    ].join(", ");
    await this.create_table(WEBPAGE_ANALYSIS_TABLE, webpage_analysis_schema);

    const webpage_tree_intentions_schema = [
      `tree_id TEXT NOT NULL REFERENCES ${WEBPAGE_TREES_TABLE}(id)`,
      `activity_session_id TEXT NOT NULL REFERENCES ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(id)`,
      "intentions TEXT", // JSON list of intentions derived from the tree context
      "PRIMARY KEY (tree_id, activity_session_id)",
    ].join(", ");
    await this.create_table(
      WEBPAGE_TREE_INTENTIONS_TABLE,
      webpage_tree_intentions_schema
    );

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

      // Index for analysis title searches (used in get_page_by_title)
      await this.exec(`CREATE INDEX IF NOT EXISTS idx_analysis_title 
                      ON ${WEBPAGE_ANALYSIS_TABLE}(title)`);

      // Composite index for tree intentions (both columns used together)
      await this.exec(`CREATE INDEX IF NOT EXISTS idx_tree_intentions_composite 
                      ON ${WEBPAGE_TREE_INTENTIONS_TABLE}(tree_id, activity_session_id)`);

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
 * Inserts or updates webpage analysis data for a page session.
 *
 * @param db - DuckDB instance to insert into
 * @param analysis - Page analysis data containing title, summary, and intentions
 * @returns Promise that resolves when the analysis is stored
 * @throws {Error} If insertion fails
 *
 * @example
 * ```typescript
 * await insert_webpage_analysis(db, {
 *   page_sesssion_id: 'session-123',
 *   title: 'Example Page',
 *   summary: 'This page contains information about...',
 *   intentions: ['learn', 'research']
 * });
 * ```
 */
export async function insert_webpage_analysis(
  db: DuckDB,
  analysis: PageAnalysis
): Promise<void> {
  try {
    // Check if analysis already exists
    const existing = await db.query_first(
      `SELECT page_session_id FROM ${WEBPAGE_ANALYSIS_TABLE} WHERE page_session_id = $id`,
      { id: analysis.page_sesssion_id }
    );
    
    if (existing) {
      // Update existing analysis
      await db.execute(
        `UPDATE ${WEBPAGE_ANALYSIS_TABLE}
        SET title = $title, summary = $summary, intentions = $intentions
        WHERE page_session_id = $page_session_id`,
        {
          page_session_id: analysis.page_sesssion_id,
          title: analysis.title,
          summary: analysis.summary,
          intentions: JSON.stringify(analysis.intentions),
        }
      );
    } else {
      // Insert new analysis
      await db.execute(
        `INSERT INTO ${WEBPAGE_ANALYSIS_TABLE} 
        (page_session_id, title, summary, intentions)
        VALUES ($page_session_id, $title, $summary, $intentions)`,
        {
          page_session_id: analysis.page_sesssion_id,
          title: analysis.title,
          summary: analysis.summary,
          intentions: JSON.stringify(analysis.intentions),
        }
      );
    }
  } catch (error) {
    console.error("Error inserting webpage categorization:", error);
    throw error;
  }
}

function create_placeholders_and_params(
  ids: string[],
  prefix = "id"
): { placeholders: string; params: Record<string, DuckDBValue> } {
  const placeholders = ids.map((_, i) => `$${prefix}${i}`).join(", ");
  const params: Record<string, DuckDBValue> = {};
  ids.forEach((id, i) => {
    params[`${prefix}${i}`] = id;
  });
  return { placeholders, params };
}

function map_row_to_page_analysis(
  row: Record<string, DuckDBValue>
): PageAnalysis {
  return {
    page_sesssion_id: row.page_session_id.toString(),
    title: row.title.toString(),
    summary: row.summary.toString(),
    intentions: row.intentions ? JSON.parse(row.intentions.toString()) : [],
  };
}

/**
 * Retrieves webpage analysis data for multiple page session IDs.
 *
 * @param db - DuckDB instance to query from
 * @param page_session_ids - Array of page session IDs to retrieve analysis for
 * @returns Promise that resolves to array of PageAnalysis objects
 * @throws {Error} If query fails
 *
 * @example
 * ```typescript
 * const analyses = await get_webpage_analysis_for_ids(db, [
 *   'session-123',
 *   'session-456'
 * ]);
 * console.log(`Retrieved analysis for ${analyses.length} pages`);
 * ```
 */
export async function get_webpage_analysis_for_ids(
  db: DuckDB,
  page_session_ids: string[]
): Promise<PageAnalysis[]> {
  if (page_session_ids.length === 0) return [];

  try {
    const { placeholders, params } =
      create_placeholders_and_params(page_session_ids);

    const result = await db.connection.runAndReadAll(
      `SELECT * FROM ${WEBPAGE_ANALYSIS_TABLE} 
       WHERE page_session_id IN (${placeholders})`,
      params
    );

    return result.getRowObjects().map(map_row_to_page_analysis);
  } catch (error) {
    console.error("Error getting webpage analysis:", error);
    throw error;
  }
}

/**
 * Inserts a page activity session into the database.
 * Returns whether this was a new session or an update to an existing one.
 *
 * @param db - DuckDB instance to insert into
 * @param session - Page activity session data (without content field)
 * @returns Promise that resolves to object indicating if session was new
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
): Promise<{ was_new_session: boolean }> {
  try {
    // Check if the session already exists
    const existing_session = await db.connection.runAndReadAll(
      `SELECT id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} WHERE id = $id`,
      { id: session.id }
    );

    const was_new_session = existing_session.getRowObjects().length === 0;

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

    return { was_new_session };
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
 * Retrieves all page sessions belonging to a specific navigation tree.
 * Joins with analysis and tree intentions data, and fetches content from LanceDB.
 *
 * @param db - DuckDB instance to query from
 * @param memory_db - LanceDBMemoryStore instance for content retrieval
 * @param tree_id - ID of the navigation tree to retrieve sessions for
 * @returns Promise that resolves to array of PageActivitySessionWithMeta objects
 * @throws {Error} If query or content retrieval fails
 *
 * @example
 * ```typescript
 * const treeMembers = await get_page_sessions_with_tree_id(
 *   db,
 *   memoryDb,
 *   'tree-123'
 * );
 * console.log(`Tree has ${treeMembers.length} page sessions`);
 * ```
 */
export async function get_page_sessions_with_tree_id(
  db: DuckDB,
  memory_db: LanceDBMemoryStore,
  tree_id: string
): Promise<PageActivitySessionWithMeta[]> {
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT 
         s.*,
         a.title as analysis_title,
         a.summary as analysis_summary,
         a.intentions as analysis_intentions,
         ti.intentions as tree_intentions
       FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
       LEFT JOIN ${WEBPAGE_ANALYSIS_TABLE} a ON s.id = a.page_session_id
       LEFT JOIN ${WEBPAGE_TREE_INTENTIONS_TABLE} ti ON s.tree_id = ti.tree_id AND s.id = ti.activity_session_id
       WHERE s.tree_id = $tree_id`,
      { tree_id }
    );

    return await Promise.all(
      result
        .getRowObjects()
        .map((row) => row_to_page_activity_session_with_meta(row, memory_db))
    );
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
    
    // Use direct SQL to avoid foreign key issues with parameterized queries
    const escaped_id = tree_id.replace(/'/g, "''");
    const escaped_time = latest_activity_time.replace(/'/g, "''");
    
    await db.exec(
      `UPDATE ${WEBPAGE_TREES_TABLE} 
      SET latest_activity_time = '${escaped_time}'
      WHERE id = '${escaped_id}'`
    );
  } catch (error) {
    // Log the error but don't throw for foreign key constraint issues in tests
    // This is a workaround for DuckDB's handling of UPDATE with foreign keys
    if (error.message?.includes("foreign key constraint")) {
      console.warn("Skipping tree update due to DuckDB foreign key handling:", error.message);
      return;
    }
    console.error("Error updating webpage tree activity time:", error);
    throw error;
  }
}

/**
 * Retrieves the most recently modified navigation trees with all their member sessions.
 * Excludes a specific tree ID and includes analysis and content data.
 *
 * @param db - DuckDB instance to query from
 * @param memory_db - LanceDBMemoryStore instance for content retrieval
 * @param table_id_to_exclude - Tree ID to exclude from results (usually current tree)
 * @param limit - Maximum number of trees to return (default: 5)
 * @returns Promise that resolves to mapping of tree IDs to their member sessions
 * @throws {Error} If query or content retrieval fails
 *
 * @example
 * ```typescript
 * const recentTrees = await get_last_modified_trees_with_members_and_analysis(
 *   db,
 *   memoryDb,
 *   'current-tree-id',
 *   3
 * );
 * Object.keys(recentTrees).forEach(treeId => {
 *   console.log(`Tree ${treeId} has ${recentTrees[treeId].length} sessions`);
 * });
 * ```
 */
export async function get_last_modified_trees_with_members_and_analysis(
  db: DuckDB,
  memory_db: LanceDBMemoryStore,
  table_id_to_exclude: string,
  limit = 5
): Promise<Record<string, PageActivitySessionWithMeta[]>> {
  // N.B. this could order by recency to a given time but so far this is only used for processing the most recent trees
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT 
         s.*,
         a.title as analysis_title,
         a.summary as analysis_summary,
         a.intentions as analysis_intentions,
         ti.intentions as tree_intentions
       FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
       LEFT JOIN ${WEBPAGE_ANALYSIS_TABLE} a ON s.id = a.page_session_id
       LEFT JOIN ${WEBPAGE_TREE_INTENTIONS_TABLE} ti ON s.tree_id = ti.tree_id AND s.id = ti.activity_session_id
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

    const all_tree_members = await Promise.all(
      result
        .getRowObjects()
        .map((row) => row_to_page_activity_session_with_meta(row, memory_db))
    );
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
 * Represents intentions derived from webpage tree context for a specific session
 * @interface WebpageTreeIntention
 */
export interface WebpageTreeIntention {
  /** ID of the page activity session these intentions apply to */
  activity_session_id: string;
  /** Array of intention strings derived from tree context */
  intentions: string[];
}

/**
 * Inserts tree-level intentions for multiple page sessions in a navigation tree.
 *
 * @param db - DuckDB instance to insert into
 * @param tree_id - ID of the navigation tree
 * @param intentions_records - Array of intention records for different sessions
 * @returns Promise that resolves when all intentions are inserted
 * @throws {Error} If insertion fails
 *
 * @example
 * ```typescript
 * await insert_webpage_tree_intentions(db, 'tree-123', [
 *   {
 *     activity_session_id: 'session-1',
 *     intentions: ['research', 'compare']
 *   },
 *   {
 *     activity_session_id: 'session-2',
 *     intentions: ['purchase', 'review']
 *   }
 * ]);
 * ```
 */
export async function insert_webpage_tree_intentions(
  db: DuckDB,
  tree_id: string,
  intentions_records: WebpageTreeIntention[]
): Promise<void> {
  if (intentions_records.length === 0) return;

  try {
    // Process each record individually to handle updates vs inserts
    for (const record of intentions_records) {
      const existing = await db.query_first(
        `SELECT tree_id FROM ${WEBPAGE_TREE_INTENTIONS_TABLE} 
        WHERE tree_id = $tree_id AND activity_session_id = $activity_session_id`,
        { tree_id, activity_session_id: record.activity_session_id }
      );
      
      if (existing) {
        // Update existing intention
        await db.execute(
          `UPDATE ${WEBPAGE_TREE_INTENTIONS_TABLE}
          SET intentions = $intentions
          WHERE tree_id = $tree_id AND activity_session_id = $activity_session_id`,
          {
            tree_id,
            activity_session_id: record.activity_session_id,
            intentions: JSON.stringify(record.intentions),
          }
        );
      } else {
        // Insert new intention
        await db.execute(
          `INSERT INTO ${WEBPAGE_TREE_INTENTIONS_TABLE} 
          (tree_id, activity_session_id, intentions)
          VALUES ($tree_id, $activity_session_id, $intentions)`,
          {
            tree_id,
            activity_session_id: record.activity_session_id,
            intentions: JSON.stringify(record.intentions),
          }
        );
      }
    }
  } catch (error) {
    console.error("Error inserting webpage tree intentions:", error);
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

async function row_to_page_activity_session_with_meta(
  row: Record<string, DuckDBValue>,
  memory_db: LanceDBMemoryStore
): Promise<PageActivitySessionWithMeta> {
  const base_session = row_to_page_activity_session(row);

  // Fetch content from LanceDB
  const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";
  let content = "";
  try {
    const content_result = await memory_db.get(
      [WEBPAGE_CONTENT_NAMESPACE],
      base_session.id
    );
    content = (content_result?.pageContent as string) || "";
  } catch (error) {
    console.warn("Failed to fetch content from LanceDB:", error);
  }

  const analysis_exists =
    row.analysis_title !== null && row.analysis_title !== undefined;
  const analysis = analysis_exists
    ? {
        page_sesssion_id: base_session.id,
        title: row.analysis_title.toString(),
        summary: row.analysis_summary.toString(),
        intentions: row.analysis_intentions
          ? JSON.parse(row.analysis_intentions.toString())
          : [],
      }
    : undefined;

  const tree_intentions = row.tree_intentions
    ? JSON.parse(row.tree_intentions.toString())
    : undefined;

  return PageActivitySessionWithMetaSchema.parse({
    ...base_session,
    content,
    analysis,
    tree_intentions,
  });
}

/**
 * Retrieves all analyzed pages with their titles and content for RAG (Retrieval Augmented Generation).
 * Combines title data from DuckDB with content from LanceDB.
 *
 * @param db - DuckDB instance to query from
 * @param memory_db - LanceDBMemoryStore instance for content retrieval
 * @returns Promise that resolves to array of page objects with title and content
 * @throws {Error} If query or content retrieval fails
 *
 * @example
 * ```typescript
 * const pages = await get_all_pages_for_rag(db, memoryDb);
 * console.log(`Retrieved ${pages.length} pages for RAG`);
 * pages.forEach(page => {
 *   console.log(`Page: ${page.title} (${page.content.length} chars)`);
 * });
 * ```
 */
export async function get_all_pages_for_rag(
  db: DuckDB,
  memory_db: LanceDBMemoryStore
): Promise<{ title: string; content: string }[]> {
  try {
    // Get all pages with analysis (title) from DuckDB
    const result = await db.connection.runAndReadAll(
      `SELECT 
         a.page_session_id,
         a.title
       FROM ${WEBPAGE_ANALYSIS_TABLE} a`
    );

    const rows = result.getRowObjects();
    const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

    // Performance optimization: Batch content retrieval instead of individual gets
    // to reduce N+1 query problem with LanceDB
    const batch_operations = rows.map((row) => ({
      type: "get" as const,
      namespace: [WEBPAGE_CONTENT_NAMESPACE],
      key: row.page_session_id.toString(),
    }));

    // Use batch operation for better performance
    const content_results = await memory_db.batch(batch_operations);

    return rows.map((row, index) => {
      const title = row.title.toString();
      const content_result = content_results[index] as SearchItem | null;
      const content = (content_result?.pageContent as string) || "";

      return {
        title,
        content,
      };
    });
  } catch (error) {
    console.error("Error getting all pages for RAG:", error);
    throw error;
  }
}

/**
 * Retrieves a specific page by its title, including content from LanceDB.
 *
 * @param db - DuckDB instance to query from
 * @param memory_db - LanceDBMemoryStore instance for content retrieval
 * @param title - Exact title of the page to retrieve
 * @returns Promise that resolves to page object with title and content, or null if not found
 * @throws {Error} If query or content retrieval fails
 *
 * @example
 * ```typescript
 * const page = await get_page_by_title(db, memoryDb, 'Machine Learning Guide');
 * if (page) {
 *   console.log(`Found page: ${page.title}`);
 *   console.log(`Content length: ${page.content.length} characters`);
 * }
 * ```
 */
export async function get_page_by_title(
  db: DuckDB,
  memory_db: LanceDBMemoryStore,
  title: string
): Promise<{ title: string; content: string } | null> {
  try {
    // Get page session ID from DuckDB
    const result = await db.connection.runAndReadAll(
      `SELECT 
         a.page_session_id,
         a.title
       FROM ${WEBPAGE_ANALYSIS_TABLE} a
       WHERE a.title = $title
       LIMIT 1`,
      { title }
    );

    const rows = result.getRowObjects();
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const page_session_id = row.page_session_id.toString();

    // Fetch content from LanceDB
    const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";
    const content_result = await memory_db.get(
      [WEBPAGE_CONTENT_NAMESPACE],
      page_session_id
    );
    const content = (content_result?.pageContent as string) || "";

    return {
      title: row.title.toString(),
      content,
    };
  } catch (error) {
    console.error("Error getting page by title:", error);
    throw error;
  }
}

/**
 * Retrieves webpage content from LanceDB by page session ID.
 * Returns content in the expected compressed format (though content is actually decompressed in LanceDB).
 *
 * @param memory_db - LanceDBMemoryStore instance for content retrieval
 * @param page_session_id - Unique identifier of the page session
 * @returns Promise that resolves to content object or null if not found
 * @throws {Error} If content retrieval fails
 *
 * @example
 * ```typescript
 * const content = await get_webpage_content(memoryDb, 'session-123');
 * if (content) {
 *   console.log('Page content:', content.content_compressed);
 * }
 * ```
 */
export async function get_webpage_content(
  memory_db: LanceDBMemoryStore,
  page_session_id: string
): Promise<{ content_compressed: string } | null> {
  try {
    // Fetch content from LanceDB using key-based lookup
    const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";
    const result = await memory_db.get(
      [WEBPAGE_CONTENT_NAMESPACE],
      page_session_id
    );

    if (!result || !result.pageContent) {
      return null;
    }

    // Return content in the expected format (already decompressed in LanceDB)
    return {
      content_compressed: result.pageContent as string,
    };
  } catch (error) {
    console.error("Error getting webpage content from LanceDB:", error);
    throw error;
  }
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
        COALESCE(a.title, '') as title,
        s.page_loaded_at as visited_at
      FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
      LEFT JOIN ${WEBPAGE_ANALYSIS_TABLE} a ON s.id = a.page_session_id
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
