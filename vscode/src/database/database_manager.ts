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
 */
export class DatabaseManager {
  private databases?: DatabaseInstances;

  /**
   * Initializes core databases (DuckDB and MarkdownDatabase).
   * 
   * @param storage_path - Path to extension storage directory
   * @param markdown_path - Path to markdown database file
   * @returns Object containing initialized database instances
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
   * 
   * @param storage_path - Path to extension storage directory
   * @param openai_api_key - OpenAI API key for embeddings
   * @returns Initialized LanceDB memory store
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
   * 
   * @param duck_db - Initialized DuckDB instance
   * @param memory_db - Initialized LanceDB memory store
   * @param enabled - Whether memory features are enabled
   * @returns Object containing initialized memory stores (if enabled)
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
   * 
   * @param context - VS Code extension context
   * @param openai_api_key - OpenAI API key
   * @param markdown_path - Path to markdown database
   * @param memory_enabled - Whether to enable memory features
   * @returns Complete set of initialized databases
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
   * 
   * @returns Current database instances or undefined if not initialized
   */
  get_databases(): DatabaseInstances | undefined {
    return this.databases;
  }
}