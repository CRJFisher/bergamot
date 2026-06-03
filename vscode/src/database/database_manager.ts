import * as path from 'path';
import { DuckDB } from '../duck_db';
import { LanceDBMemoryStore } from '../lance_db';
import { create_embeddings } from '../workflow/embeddings';

/**
 * Result of database initialization containing all database instances.
 *
 * @interface DatabaseInstances
 * @property {DuckDB} duck_db - DuckDB instance for structured webpage data storage
 * @property {LanceDBMemoryStore} memory_db - LanceDB store for embeddings and vector search
 */
export interface DatabaseInstances {
  duck_db: DuckDB;
  memory_db: LanceDBMemoryStore;
}

/**
 * Manages database initialization and lifecycle for the PKM Assistant extension.
 * Provides centralized control over all database connections and ensures proper
 * initialization order and cleanup.
 * 
 * @example
 * ```typescript
 * const dbManager = new DatabaseManager();
 * const databases = await dbManager.initialize_all(context, apiKey);
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
   * Initializes the memory store with embeddings support.
   * Creates a LanceDB instance with OpenAI embeddings for semantic search capabilities.
   * 
   * @param storage_path - Path to extension storage directory
   * @param openai_api_key - OpenAI API key for generating embeddings
   * @returns Initialized LanceDB memory store
   * @throws {Error} If LanceDB initialization fails
   * @example
   * ```typescript
   * const memoryDb = await dbManager.initialize_memory_store(
   *   '/path/to/storage',
   *   'sk-...'
   * );
   * // Now you can perform semantic search
   * const results = await memoryDb.search('query text');
   * ```
   */
  async initialize_memory_store(
    storage_path: string
  ): Promise<LanceDBMemoryStore> {
    console.log('Initializing memory store...');

    // The LanceDB store lives in a dedicated subdirectory of the storage path.
    // Readers (the MCP server) resolve the same `webpage_memory.db` path, so the
    // writer must use it too or semantic search reads an empty store.
    const memory_db_path = path.join(storage_path, 'webpage_memory.db');
    const memory_db = await LanceDBMemoryStore.create(memory_db_path, {
      embeddings: create_embeddings(),
    });

    console.log('Memory store initialized successfully');
    return memory_db;
  }

  /**
   * Initializes all databases required by the extension: the DuckDB relational
   * store and the LanceDB vector store.
   *
   * @param storage_path - Resolved storage base directory (dev or global)
   * @returns Complete set of initialized databases
   * @throws {Error} If any database initialization fails
   * @example
   * ```typescript
   * const dbManager = new DatabaseManager();
   * const databases = await dbManager.initialize_all(storage_base);
   * // All databases are now ready to use
   * ```
   */
  async initialize_all(
    storage_path: string
  ): Promise<DatabaseInstances> {
    const duck_db = new DuckDB({
      database_path: path.join(storage_path, 'webpage_categorizations.db'),
    });
    await duck_db.init();

    const memory_db = await this.initialize_memory_store(storage_path);

    this.databases = { duck_db, memory_db };
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
    if (this.databases?.memory_db) {
      this.databases.memory_db.stop();
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