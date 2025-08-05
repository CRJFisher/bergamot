import {
  DuckDBInstance,
  DuckDBConnection,
  DuckDBValue,
} from "@duckdb/node-api";
import { compress, decompress } from "@mongodb-js/zstd";
import * as path from "path";
import * as fs from "fs";
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

export interface DuckDBConfig {
  database_path: string;
  read_only?: boolean;
}

const WEBPAGE_ANALYSIS_TABLE = "webpage_analysis";
const WEBPAGE_ACTIVITY_SESSIONS_TABLE = "webpage_activity_sessions";
const WEBPAGE_TREES_TABLE = "webpage_trees";
const WEBPAGE_TREE_INTENTIONS_TABLE = "webpage_tree_intentions";
const WEBPAGE_CONTENT_TABLE = "webpage_content";

export class DuckDB {
  private db: DuckDBInstance;
  public connection: DuckDBConnection;
  private config: DuckDBConfig;

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

    const webpage_content_schema = [
      "activity_session_id TEXT PRIMARY KEY",
      "content_compressed TEXT", // base64 encoded compressed zstd processed content
      `FOREIGN KEY (activity_session_id) REFERENCES ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(id)`,
    ].join(", ");
    await this.create_table(WEBPAGE_CONTENT_TABLE, webpage_content_schema);

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
  }

  /**
   * Execute a query and return all results
   */
  async query<T>(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<T[]> {
    const result = await this.connection.run(sql, params);
    return result as unknown as T[];
  }

  /**
   * Execute a query and return the first result
   */
  async query_first<T>(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Execute a query that doesn't return results (INSERT, UPDATE, DELETE)
   */
  async execute(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<void> {
    await this.connection.run(sql, params);
  }

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
   * Close the database connection
   */
  async close(): Promise<void> {
    this.connection.disconnectSync();
  }

  // Helper methods for episodic memory compatibility
  async exec(sql: string): Promise<void> {
    await this.connection.run(sql);
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    if (params.length === 0) {
      await this.connection.run(sql);
      return;
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
      param_obj[`${index + 1}`] = value;
    });
    
    await this.connection.run(modified_sql, param_obj);
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (params.length === 0) {
      const result = await this.connection.runAndReadAll(sql);
      return result.getRowObjects() as T[];
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
      param_obj[`${index + 1}`] = value;
    });
    
    const result = await this.connection.runAndReadAll(modified_sql, param_obj);
    return result.getRowObjects() as T[];
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const results = await this.all<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }
}

export async function insert_webpage_analysis(
  db: DuckDB,
  analysis: PageAnalysis
): Promise<void> {
  try {
    await db.execute(
      `INSERT OR REPLACE INTO ${WEBPAGE_ANALYSIS_TABLE} 
      (page_session_id, title, summary, intentions)
      VALUES ($page_session_id, $title, $summary, $intentions)`,
      {
        page_session_id: analysis.page_sesssion_id,
        title: analysis.title,
        summary: analysis.summary,
        intentions: JSON.stringify(analysis.intentions),
      }
    );
  } catch (error) {
    console.error("Error inserting webpage categorization:", error);
    throw error;
  }
}

export async function insert_webpage_content(
  db: DuckDB,
  activity_session_id: string,
  processed_content: string
): Promise<void> {
  try {
    // Compress the processed content using zstd
    const content_buffer = Buffer.from(processed_content, "utf-8");
    const compressed_content = await compress(content_buffer, 6); // Level 6 compression

    // Convert to base64 for storage
    const base64_compressed = compressed_content.toString("base64");

    await db.execute(
      `INSERT OR REPLACE INTO ${WEBPAGE_CONTENT_TABLE} 
      (activity_session_id, content_compressed)
      VALUES ($activity_session_id, $content_compressed)`,
      {
        activity_session_id: activity_session_id,
        content_compressed: base64_compressed,
      }
    );
  } catch (error) {
    console.error("Error inserting webpage content:", error);
    throw error;
  }
}

export async function get_webpage_analysis_for_ids(
  db: DuckDB,
  page_session_ids: string[]
): Promise<PageAnalysis[]> {
  if (page_session_ids.length === 0) return [];
  try {
    const placeholders = page_session_ids.map((_, i) => `$id${i}`).join(", ");
    const params: Record<string, DuckDBValue> = {};
    page_session_ids.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const result = await db.connection.runAndReadAll(
      `SELECT * FROM ${WEBPAGE_ANALYSIS_TABLE} 
       WHERE page_session_id IN (${placeholders})`,
      params
    );

    return result.getRowObjects().map((row) => ({
      page_sesssion_id: row.page_session_id.toString(),
      title: row.title.toString(),
      summary: row.summary.toString(),
      intentions: row.intentions ? JSON.parse(row.intentions.toString()) : [],
    }));
  } catch (error) {
    console.error("Error getting webpage analysis:", error);
    throw error;
  }
}

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

    await db.execute(
      `INSERT OR REPLACE INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} 
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

    return { was_new_session };
  } catch (error) {
    console.error("Error inserting page activity session:", error);
    throw error;
  }
}

/**
 * Find a navigation tree that contains the specified URL
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

export async function get_page_sessions_with_tree_id(
  db: DuckDB,
  tree_id: string
): Promise<PageActivitySessionWithMeta[]> {
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT 
         s.*,
         a.title as analysis_title,
         a.summary as analysis_summary,
         a.intentions as analysis_intentions,
         ti.intentions as tree_intentions,
         c.content_compressed
       FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} s
       LEFT JOIN ${WEBPAGE_ANALYSIS_TABLE} a ON s.id = a.page_session_id
       LEFT JOIN ${WEBPAGE_TREE_INTENTIONS_TABLE} ti ON s.tree_id = ti.tree_id AND s.id = ti.activity_session_id
       LEFT JOIN ${WEBPAGE_CONTENT_TABLE} c ON s.id = c.activity_session_id
       WHERE s.tree_id = $tree_id`,
      { tree_id }
    );

    return await Promise.all(
      result.getRowObjects().map(row_to_page_activity_session_with_meta)
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

export async function insert_webpage_tree(
  db: DuckDB,
  tree_id: string,
  first_load_time: string,
  latest_activity_time: string
): Promise<void> {
  try {
    await db.execute(
      `INSERT OR REPLACE INTO ${WEBPAGE_TREES_TABLE} 
      (id, first_load_time, latest_activity_time)
      VALUES ($id, $first_load_time, $latest_activity_time)`,
      {
        id: tree_id,
        first_load_time,
        latest_activity_time,
      }
    );
  } catch (error) {
    console.error("Error inserting webpage tree:", error);
    throw error;
  }
}

export async function update_webpage_tree_activity_time(
  db: DuckDB,
  tree_id: string,
  latest_activity_time: string
): Promise<void> {
  try {
    await db.execute(
      `UPDATE ${WEBPAGE_TREES_TABLE} 
      SET latest_activity_time = $latest_activity_time
      WHERE id = $tree_id`,
      {
        tree_id,
        latest_activity_time,
      }
    );
  } catch (error) {
    console.error("Error updating webpage tree activity time:", error);
    throw error;
  }
}

export async function get_last_modified_trees_with_members_and_analysis(
  db: DuckDB,
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
      result.getRowObjects().map(row_to_page_activity_session_with_meta)
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

export interface WebpageTreeIntention {
  activity_session_id: string;
  intentions: string[];
}

export async function insert_webpage_tree_intentions(
  db: DuckDB,
  tree_id: string,
  intentions_records: WebpageTreeIntention[]
): Promise<void> {
  if (intentions_records.length === 0) return;

  try {
    // Batch all inserts into a single SQL statement
    const values_clauses = intentions_records
      .map(
        (_, index) =>
          `($tree_id, $activity_session_id_${index}, $intentions_${index})`
      )
      .join(", ");

    const params: Record<string, DuckDBValue> = { tree_id };
    intentions_records.forEach((record, index) => {
      params[`activity_session_id_${index}`] = record.activity_session_id;
      params[`intentions_${index}`] = JSON.stringify(record.intentions);
    });

    await db.execute(
      `INSERT OR REPLACE INTO ${WEBPAGE_TREE_INTENTIONS_TABLE} 
      (tree_id, activity_session_id, intentions)
      VALUES ${values_clauses}`,
      params
    );
  } catch (error) {
    console.error("Error inserting webpage tree intentions:", error);
    throw error;
  }
}

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
  row: Record<string, DuckDBValue>
): Promise<PageActivitySessionWithMeta> {
  const base_session = row_to_page_activity_session(row);

  // Decompress content if available
  let content = "";
  if (row.content_compressed) {
    try {
      const compressed_data = Buffer.from(
        row.content_compressed.toString(),
        "base64"
      );
      const decompressed_data = await decompress(compressed_data);
      content = decompressed_data.toString("utf-8");
    } catch (error) {
      console.warn("Failed to decompress content:", error);
    }
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

export async function get_all_pages_for_rag(
  db: DuckDB
): Promise<{ title: string; content: string }[]> {
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT 
         a.title,
         c.content_compressed
       FROM ${WEBPAGE_ANALYSIS_TABLE} a
       JOIN ${WEBPAGE_CONTENT_TABLE} c ON a.page_session_id = c.activity_session_id`
    );

    return await Promise.all(
      result.getRowObjects().map(async (row) => {
        let content = "";
        if (row.content_compressed) {
          try {
            const compressed_data = Buffer.from(
              row.content_compressed.toString(),
              "base64"
            );
            const decompressed_data = await decompress(compressed_data);
            content = decompressed_data.toString("utf-8");
          } catch (error) {
            console.warn("Failed to decompress content:", error);
          }
        }
        return {
          title: row.title.toString(),
          content,
        };
      })
    );
  } catch (error) {
    console.error("Error getting all pages for RAG:", error);
    throw error;
  }
}

export async function get_page_by_title(
  db: DuckDB,
  title: string
): Promise<{ title: string; content: string } | null> {
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT 
         a.title,
         c.content_compressed
       FROM ${WEBPAGE_ANALYSIS_TABLE} a
       JOIN ${WEBPAGE_CONTENT_TABLE} c ON a.page_session_id = c.activity_session_id
       WHERE a.title = $title
       LIMIT 1`,
      { title }
    );

    const rows = result.getRowObjects();
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    let content = "";
    if (row.content_compressed) {
      try {
        const compressed_data = Buffer.from(
          row.content_compressed.toString(),
          "base64"
        );
        const decompressed_data = await decompress(compressed_data);
        content = decompressed_data.toString("utf-8");
      } catch (error) {
        console.warn("Failed to decompress content:", error);
      }
    }
    return {
      title: row.title.toString(),
      content,
    };
  } catch (error) {
    console.error("Error getting page by title:", error);
    throw error;
  }
}

export async function get_webpage_content(
  db: DuckDB,
  page_session_id: string
): Promise<{ content_compressed: string } | null> {
  try {
    const result = await db.connection.runAndReadAll(
      `SELECT content_compressed
       FROM ${WEBPAGE_CONTENT_TABLE}
       WHERE activity_session_id = $page_session_id
       LIMIT 1`,
      { page_session_id }
    );

    const rows = result.getRowObjects();
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    let content = "";
    if (row.content_compressed) {
      try {
        const compressed_data = Buffer.from(
          row.content_compressed.toString(),
          "base64"
        );
        const decompressed_data = await decompress(compressed_data);
        content = decompressed_data.toString("utf-8");
      } catch (error) {
        console.warn("Failed to decompress content:", error);
        content = row.content_compressed.toString();
      }
    }
    return {
      content_compressed: content,
    };
  } catch (error) {
    console.error("Error getting webpage content:", error);
    throw error;
  }
}
