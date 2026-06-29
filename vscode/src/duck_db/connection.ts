import {
  DuckDBInstance,
  DuckDBConnection,
  DuckDBValue,
  DuckDBType,
} from "@duckdb/node-api";
import * as path from "path";
import * as fs from "fs";

export interface DuckDBConfig {
  database_path: string;
  /** Required for file-backed databases. Omit for :memory: databases. */
  encryption_key?: string;
}

/** Alias under which the encrypted database file is attached. */
export const STORE_ALIAS = "bergamot_store";

/**
 * Normalized open target: an ephemeral in-memory database, or an encrypted
 * file-backed store. The discriminated shape makes "file ⇒ key" structural.
 */
type StoreTarget =
  | { in_memory: true }
  | { in_memory: false; database_path: string; encryption_key: string };

/** Escapes a value for inclusion in a single-quoted SQL string literal. */
export function sql_string_literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Generic encrypted single-file DuckDB store. Opens (and closes) the store —
 * a file-backed database is only ever created encrypted — and exposes query
 * helpers; the schema is the store owner's contract, created explicitly after
 * init ({@link create_metadata_schema} for the metadata store,
 * `create_content_cache_schema` for the content cache).
 */
export class DuckDB {
  private db: DuckDBInstance;
  public connection: DuckDBConnection;
  private readonly target: StoreTarget;

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
    // key cannot produce a parser error that echoes key material into logs).
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
    const dir = path.dirname(config.database_path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async init(): Promise<void> {
    // The instance itself is always in-memory; a file-backed store is attached
    // with DuckDB native encryption so the file is only ever created (and
    // opened) encrypted.
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

  // Attaches the encrypted file store (no-op for :memory:). Temp-file settings
  // close the remaining plaintext spill channel: DuckDB encrypts the database
  // file and WAL, but memory-pressure spill files are encrypted only when
  // temp_file_encryption is on, and they default to a cwd-relative .tmp
  // directory — both are pinned here.
  private async open_target_store(): Promise<void> {
    const target = this.target;
    if (target.in_memory === true) return;
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

  async query<T>(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<T[]> {
    const result = await this.connection.runAndReadAll(sql, params);
    return result.getRowObjects() as T[];
  }

  async query_first<T>(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  async execute(
    sql: string,
    params: Record<string, DuckDBValue> = {},
    // Explicit per-parameter DuckDB types. Pass when DuckDB's type inference
    // would pick the wrong type — notably a FLOAT[]/DOUBLE[] list bound from a
    // JS number[] whose leading element is integer-valued (see PageVectorStore.put).
    types?: Record<string, DuckDBType | undefined>
  ): Promise<void> {
    await this.connection.run(sql, params, types);
  }

  async create_table(table_name: string, schema: string): Promise<void> {
    await this.connection.run(
      `CREATE TABLE IF NOT EXISTS ${table_name} (${schema})`
    );
  }

  // A DEDICATED connection to the same store, so concurrent statements on the
  // shared main connection never join — or get rolled back with — this
  // transaction.
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

  /** Safe to call on an uninitialized or partially-initialized wrapper. */
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.disconnectSync();
    }
    if (this.db) {
      this.db.closeSync();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.connection.run(sql);
  }
}
