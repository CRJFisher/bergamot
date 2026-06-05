import * as path from 'path';
import { DuckDB } from '../duck_db';

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
 * const dbManager = new DatabaseManager();
 * const databases = await dbManager.initialize_all(storage_base);
 *
 * // Use databases
 * await databases.duck_db.query('SELECT * FROM pages');
 *
 * // Cleanup when done
 * await dbManager.close_all();
 * ```
 */
export class DatabaseManager {
  private databases?: DatabaseInstances;

  /**
   * Initializes the DuckDB relational + raw-page capture store. Ingestion is
   * DuckDB-only; vector search is reintroduced by the RAG-prep pipeline (task-31).
   *
   * @param storage_path - Resolved storage base directory (dev or global)
   * @returns Complete set of initialized databases
   * @throws {Error} If initialization fails
   */
  async initialize_all(
    storage_path: string
  ): Promise<DatabaseInstances> {
    const duck_db = new DuckDB({
      database_path: path.join(storage_path, 'webpage_categorizations.db'),
    });
    await duck_db.init();

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