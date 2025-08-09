import * as vscode from 'vscode';
import * as path from 'path';
import { DuckDB } from '../duck_db';
import { MarkdownDatabase } from '../markdown_db';
import { LanceDBMemoryStore } from '../lance_db';
import { OpenAIEmbeddings } from '../workflow/embeddings';
import { EpisodicMemoryStore } from '../memory/episodic_memory_store';
import { ProceduralMemoryStore } from '../memory/procedural_memory_store';

/**
 * Result of database initialization containing all database instances.
 * Provides access to all initialized databases used by the PKM Assistant.
 * 
 * @interface DatabaseInstances
 * @property {DuckDB} duck_db - DuckDB instance for structured webpage data storage
 * @property {MarkdownDatabase} markdown_db - Database for markdown-based webpage content
 * @property {LanceDBMemoryStore} memory_db - LanceDB store for embeddings and vector search
 * @property {EpisodicMemoryStore} [episodic_store] - Optional episodic memory for learning from user feedback
 * @property {ProceduralMemoryStore} [procedural_store] - Optional procedural memory for filter rules
 */
export interface DatabaseInstances {
  duck_db: DuckDB;
  markdown_db: MarkdownDatabase;
  memory_db: LanceDBMemoryStore;
  episodic_store?: EpisodicMemoryStore;
  procedural_store?: ProceduralMemoryStore;
}

/**
 * Manages database initialization and lifecycle for the PKM Assistant extension.
 * Provides centralized control over all database connections and ensures proper
 * initialization order and cleanup.
 * 
 * @example
 * ```typescript
 * const dbManager = new DatabaseManager();
 * const databases = await dbManager.initialize_all(
 *   context,
 *   apiKey,
 *   markdownPath,
 *   true // enable memory features
 * );
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
   * Initializes core databases (DuckDB and MarkdownDatabase).
   * These are the essential databases required for basic operation.
   * 
   * @param storage_path - Path to extension storage directory
   * @param markdown_path - Path to markdown database file
   * @returns Object containing initialized database instances
   * @throws {Error} If database initialization fails
   * @example
   * ```typescript
   * const { duck_db, markdown_db } = await dbManager.initialize_core_databases(
   *   '/path/to/storage',
   *   '/path/to/markdown.md'
   * );
   * ```
   */
  async initialize_core_databases(
    storage_path: string,
    markdown_path: string
  ): Promise<{ duck_db: DuckDB; markdown_db: MarkdownDatabase }> {
    console.log('Initializing databases...');
    
    const markdown_db = new MarkdownDatabase(markdown_path);
    
    const duck_db = new DuckDB({
      database_path: path.join(storage_path, 'webpage_categorizations.db')
    });
    await duck_db.init();
    
    console.log('Databases initialized successfully');
    return { duck_db, markdown_db };
  }

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
    storage_path: string,
    openai_api_key: string
  ): Promise<LanceDBMemoryStore> {
    console.log('Initializing memory store...');
    
    const memory_db = await LanceDBMemoryStore.create(storage_path, {
      embeddings: new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: openai_api_key,
      }),
    });
    
    console.log('Memory store initialized successfully');
    return memory_db;
  }

  /**
   * Initializes episodic and procedural memory stores if enabled.
   * These advanced memory features allow the system to learn from user feedback
   * and apply custom filtering rules.
   * 
   * @param duck_db - Initialized DuckDB instance for data storage
   * @param memory_db - Initialized LanceDB memory store for embeddings
   * @param enabled - Whether memory features are enabled in configuration
   * @returns Object containing initialized memory stores (empty if disabled)
   * @example
   * ```typescript
   * const { episodic_store, procedural_store } = await dbManager.initialize_memory_features(
   *   duckDb,
   *   memoryDb,
   *   true
   * );
   * 
   * if (episodic_store) {
   *   // Store user feedback
   *   await episodic_store.store_correction(...);
   * }
   * ```
   */
  async initialize_memory_features(
    duck_db: DuckDB,
    memory_db: LanceDBMemoryStore,
    enabled: boolean
  ): Promise<{
    episodic_store?: EpisodicMemoryStore;
    procedural_store?: ProceduralMemoryStore;
  }> {
    if (!enabled) {
      console.log('Memory features disabled');
      return {};
    }

    console.log('Initializing episodic memory store...');
    const episodic_store = new EpisodicMemoryStore(duck_db, memory_db);
    await episodic_store.initialize();

    console.log('Initializing procedural memory store...');
    const procedural_store = new ProceduralMemoryStore(duck_db);
    await procedural_store.initialize();

    return { episodic_store, procedural_store };
  }

  /**
   * Initializes all databases required by the extension.
   * This is the main entry point for database initialization, handling all
   * databases in the correct order with proper dependencies.
   * 
   * @param context - VS Code extension context for accessing storage paths
   * @param openai_api_key - OpenAI API key for embeddings
   * @param markdown_path - Path to markdown database file
   * @param memory_enabled - Whether to enable advanced memory features
   * @returns Complete set of initialized databases
   * @throws {Error} If any database initialization fails
   * @example
   * ```typescript
   * const dbManager = new DatabaseManager();
   * const databases = await dbManager.initialize_all(
   *   context,
   *   'sk-...',
   *   '/path/to/markdown.md',
   *   true
   * );
   * // All databases are now ready to use
   * ```
   */
  async initialize_all(
    context: vscode.ExtensionContext,
    openai_api_key: string,
    markdown_path: string,
    memory_enabled: boolean
  ): Promise<DatabaseInstances> {
    const storage_path = context.globalStorageUri.fsPath;
    
    // Initialize core databases
    const { duck_db, markdown_db } = await this.initialize_core_databases(
      storage_path,
      markdown_path
    );
    
    // Initialize memory store
    const memory_db = await this.initialize_memory_store(
      storage_path,
      openai_api_key
    );
    
    // Initialize memory features if enabled
    const { episodic_store, procedural_store } = await this.initialize_memory_features(
      duck_db,
      memory_db,
      memory_enabled
    );
    
    this.databases = {
      duck_db,
      markdown_db,
      memory_db,
      episodic_store,
      procedural_store
    };
    
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