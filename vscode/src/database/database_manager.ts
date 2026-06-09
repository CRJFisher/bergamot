import * as path from 'path';
import { DuckDB, create_metadata_schema } from '../duck_db';

/** Filename of the encrypted DuckDB metadata store under the storage base. */
export const METADATA_DB_FILENAME = 'webpage_categorizations.db';

/**
 * Result of database initialization containing all database instances.
 *
 * @interface DatabaseInstances
 * @property {DuckDB} duck_db - DuckDB instance for structured webpage data + captures
 */
export interface DatabaseInstances {
  duck_db: DuckDB;
}

/**
 * Manages database initialization and lifecycle for the Bergamot extension.
 * Provides centralized control over all database connections and ensures proper
 * initialization order and cleanup.
 *
 * @example
 * ```typescript
 * const db_manager = new DatabaseManager();
 * const databases = await db_manager.initialize_all(storage_base, encryption_key);
 *
 * // Use databases
 * await databases.duck_db.query('SELECT * FROM pages');
 *
 * // Cleanup when done
 * await db_manager.close_all();
 * ```
 */
export class DatabaseManager {
  private databases?: DatabaseInstances;

  /**
   * Initializes the DuckDB relational metadata store, encrypted at rest with
   * DuckDB native encryption. Ingestion is DuckDB-only; vector search is
   * reintroduced by the RAG-prep pipeline (task-31).
   *
   * @param storage_path - Resolved storage base directory (dev or global)
   * @param encryption_key - Data-encryption key for the store, sourced from
   *   the OS keystore via VS Code `SecretStorage` (see
   *   `database/encryption_key.ts`)
   * @returns Complete set of initialized databases
   * @throws {Error} If initialization fails
   */
  async initialize_all(
    storage_path: string,
    encryption_key: string
  ): Promise<DatabaseInstances> {
    const duck_db = new DuckDB({
      database_path: path.join(storage_path, METADATA_DB_FILENAME),
      encryption_key,
    });
    await duck_db.init();
    await create_metadata_schema(duck_db);

    this.databases = { duck_db };
    return this.databases;
  }

  /**
   * Closes all open database connections.
   * Should be called during extension deactivation to ensure clean shutdown.
   * 
   * @returns Promise that resolves when all databases are closed
   * @example
   * ```typescript
   * // In deactivate function
   * await dbManager.close_all();
   * console.log('All databases closed');
   * ```
   */
  async close_all(): Promise<void> {
    if (this.databases?.duck_db) {
      await this.databases.duck_db.close();
    }
    console.log('All databases closed');
  }

  /**
   * Gets the current database instances.
   * Provides access to the initialized databases for direct use.
   * 
   * @returns Current database instances or undefined if not initialized
   * @example
   * ```typescript
   * const databases = dbManager.get_databases();
   * if (databases) {
   *   await databases.duck_db.query('SELECT * FROM pages');
   * }
   * ```
   */
  get_databases(): DatabaseInstances | undefined {
    return this.databases;
  }
}