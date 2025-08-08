// Vanilla TypeScript implementation of memory store, replacing LangGraph checkpoint
import { Embeddings } from './workflow/embeddings';

// Type definitions to replace LangGraph types

/**
 * Represents a searchable item in the memory store with metadata
 * @interface SearchItem
 */
export interface SearchItem extends Record<string, unknown> {
  /** Unique identifier for the item */
  key: string;
  /** ISO timestamp when the item was created */
  created_at?: string;
  /** ISO timestamp when the item was last updated */
  updated_at?: string;
  /** Similarity distance score from vector search (lower is more similar) */
  _distance?: number;
}

/**
 * Represents a memory store operation (get, put, delete, or search)
 * @interface Operation
 */
export interface Operation {
  /** Type of operation to perform */
  type: 'get' | 'put' | 'delete' | 'search';
  /** Namespace path for get/put/delete operations */
  namespace?: string[];
  /** Namespace prefix for search operations */
  namespacePrefix?: string[];
  /** Key identifier for get/put/delete operations */
  key?: string;
  /** Data to store for put operations */
  value?: Record<string, unknown>;
  /** Search query text for search operations */
  query?: string;
}

/**
 * Maps operation types to their expected return types
 * @template T - Array of Operation types
 */
export type OperationResults<T extends Operation[]> = {
  [K in keyof T]: T[K]['type'] extends 'get' ? SearchItem | null :
                  T[K]['type'] extends 'search' ? SearchItem[] :
                  T[K]['type'] extends 'put' | 'delete' ? undefined :
                  never;
};
import * as lancedb from "@lancedb/lancedb";
import {
  // WebpageCategorisationAndMetadata,
  Note,
  NoteSchema,
} from "./model_schema";
import { NoteTools } from "./note_tools";

// Memory namespace constants
export const MEMORY_NAMESPACES = {
  NOTE_DESCRIPTIONS: "note_descriptions",
};

/**
 * LanceDB-based implementation of memory store with vector search capabilities.
 * Provides persistent storage and retrieval of documents with semantic search support.
 * 
 * @example
 * ```typescript
 * const embeddings = new OpenAIEmbeddings({ apiKey: 'your-key' });
 * const store = await LanceDBMemoryStore.create('/path/to/db', { embeddings });
 * 
 * // Store a document
 * await store.put(['documents'], 'doc-1', { content: 'Hello world' });
 * 
 * // Search for similar documents
 * const results = await store.search(['documents'], { query: 'greeting', limit: 5 });
 * ```
 */
export class LanceDBMemoryStore {
  private db: lancedb.Connection;
  private tableCache = new Map<string, lancedb.Table>();
  public embeddings?: Embeddings;
  
  // Performance optimization: Add caching for embeddings and search results
  private embedding_cache = new Map<string, number[]>();
  private search_result_cache = new Map<string, { results: SearchItem[]; timestamp: number }>();
  private readonly CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 1000;

  private constructor(
    db: lancedb.Connection,
    options?: { embeddings?: Embeddings }
  ) {
    this.db = db;
    this.embeddings = options?.embeddings;
  }

  /**
   * Creates and initializes a new LanceDBMemoryStore instance.
   * Automatically populates note descriptions if embeddings are provided and the table doesn't exist.
   * 
   * @param db_path - File system path where the LanceDB database will be stored
   * @param options - Optional configuration object
   * @param options.embeddings - Embeddings instance for vector operations (required for search)
   * @returns Promise that resolves to the initialized memory store
   * @throws {Error} If database initialization fails
   * 
   * @example
   * ```typescript
   * const embeddings = new OpenAIEmbeddings({ apiKey: 'your-key' });
   * const store = await LanceDBMemoryStore.create('./memory.db', { embeddings });
   * ```
   */
  static async create(
    db_path: string,
    options?: { embeddings?: Embeddings }
  ): Promise<LanceDBMemoryStore> {
    const db = await lancedb.connect(db_path);
    const store = new LanceDBMemoryStore(db, options);
    const namespaces = await store.list_namespaces();

    const should_populate_note_descriptions = !namespaces.some(
      (ns) => ns.join("_") === MEMORY_NAMESPACES.NOTE_DESCRIPTIONS
    );
    if (should_populate_note_descriptions && store.embeddings) {
      const table = await create_note_descriptions_table(store, db);
      store.tableCache.set(MEMORY_NAMESPACES.NOTE_DESCRIPTIONS, table);
    }
    return store;
  }

  private async get_table(namespace: string[]): Promise<lancedb.Table> {
    const ns = namespace.join("_");
    if (this.tableCache.has(ns)) return this.tableCache.get(ns)!;

    try {
      // Try to open existing table first
      const table = await this.db.openTable(ns);
      
      // Performance optimization: Limit table cache size to prevent memory leaks
      if (this.tableCache.size >= this.MAX_CACHE_SIZE) {
        // Remove oldest entry (first in, first out)
        const first_key = this.tableCache.keys().next().value;
        this.tableCache.delete(first_key);
      }
      
      this.tableCache.set(ns, table);
      return table;
    } catch (e) {
      // TODO: handle this
      console.error("Error opening table:", e);
      throw e;
      // If table doesn't exist, create it with schema

      // const table = await this.db.createTable(ns, [], {
      //   mode: "create",
      //   existOk: true,
      //   schema: schema,
      // });
      // this.tableCache.set(ns, table);
      // return table;
    }
  }

  /**
   * Performance optimization: Clean up expired cache entries to prevent memory leaks
   * @private
   */
  private cleanup_caches(): void {
    const now = Date.now();
    
    // Clean up search result cache
    for (const [key, value] of this.search_result_cache.entries()) {
      if (now - value.timestamp > this.CACHE_EXPIRY_MS) {
        this.search_result_cache.delete(key);
      }
    }
    
    // Limit embedding cache size
    if (this.embedding_cache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.embedding_cache.entries());
      const to_remove = entries.slice(0, entries.length - this.MAX_CACHE_SIZE);
      for (const [key] of to_remove) {
        this.embedding_cache.delete(key);
      }
    }
  }

  /**
   * Retrieves a single item by key from the specified namespace.
   * 
   * @param namespace - Array of strings defining the namespace path (e.g., ['documents', 'notes'])
   * @param key - Unique identifier for the item to retrieve
   * @returns Promise that resolves to the item if found, null otherwise
   * @throws {Error} If table access fails
   * 
   * @example
   * ```typescript
   * const item = await store.get(['documents'], 'doc-123');
   * if (item) {
   *   console.log('Found document:', item);
   * }
   * ```
   */
  async get(namespace: string[], key: string): Promise<SearchItem | null> {
    const table = await this.get_table(namespace);
    const results = await table.query().where(`key = '${key}'`).toArray();
    if (results.length === 0) return null;

    return results[0];
  }

  /**
   * Stores an item in the specified namespace with the given key.
   * Automatically generates embeddings if embeddings instance is available.
   * 
   * @param namespace - Array of strings defining the namespace path
   * @param key - Unique identifier for the item
   * @param value - Data object to store (will be flattened for storage)
   * @param _index - Reserved for future indexing functionality (currently unused)
   * @returns Promise that resolves when the item is stored
   * @throws {Error} If table access or embedding generation fails
   * 
   * @example
   * ```typescript
   * await store.put(['documents'], 'doc-123', {
   *   title: 'My Document',
   *   content: 'Document content here',
   *   sections: ['intro', 'body', 'conclusion']
   * });
   * ```
   */
  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    _index?: false | string[] // TODO: implement indexing for improved performance
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    const table = await this.get_table(namespace);
    const now = new Date().toISOString();

    // Performance optimization: Generate embedding with caching
    let vector = null;
    if (this.embeddings) {
      const val_string = get_value_string(value);
      
      // Check cache first
      let embedding = this.embedding_cache.get(val_string);
      if (!embedding) {
        embedding = await this.embeddings.embedQuery(val_string);
        this.embedding_cache.set(val_string, embedding);
        
        // Periodic cleanup
        if (this.embedding_cache.size % 100 === 0) {
          this.cleanup_caches();
        }
      }
      
      vector = Buffer.from(new Float32Array(embedding).buffer);
    }

    // Handle sections consistently with our retrieval approach
    const flattenedRecord: Record<string, unknown> = {
      key,
      vector,
      created_at: now,
      updated_at: now,
    };

    // Copy all other properties except 'sections'
    for (const [k, v] of Object.entries(value)) {
      if (k === "sections" && Array.isArray(v)) {
        // Convert sections array to delimited string
        flattenedRecord.sections_string = v.join("|||");
      } else {
        flattenedRecord[k] = v;
      }
    }

    // Write to database
    await table.add([flattenedRecord]);
  }

  /**
   * Performs vector-based semantic search within the specified namespace.
   * Supports both similarity search (with query) and basic retrieval.
   * 
   * @param namespacePrefix - Array of strings defining the namespace to search
   * @param options - Optional search configuration
   * @param options.query - Text query for semantic similarity search
   * @param options.limit - Maximum number of results to return (default: 10)
   * @param options.filter - Field-based filters to apply to results
   * @returns Promise that resolves to array of matching items, ordered by similarity
   * @throws {Error} If search operation fails
   * 
   * @example
   * ```typescript
   * // Semantic search
   * const results = await store.search(['documents'], {
   *   query: 'machine learning algorithms',
   *   limit: 5,
   *   filter: { type: 'article' }
   * });
   * 
   * // Get all items from namespace
   * const allDocs = await store.search(['documents'], { limit: 100 });
   * ```
   */
  async search(
    namespacePrefix: string[],
    options?: {
      query?: string;
      limit?: number;
      filter?: Record<string, string | { operator: string; value: string }>;
    }
  ): Promise<SearchItem[]> {
    // Performance optimization: Create cache key for search results
    const cache_key = JSON.stringify({ namespacePrefix, options });
    const cached_result = this.search_result_cache.get(cache_key);
    
    if (cached_result && Date.now() - cached_result.timestamp < this.CACHE_EXPIRY_MS) {
      return cached_result.results;
    }

    const table = await this.get_table(namespacePrefix);

    let results: SearchItem[];
    
    if (options?.query && this.embeddings) {
      // Performance optimization: Use cached embeddings for query vector
      let queryVector = this.embedding_cache.get(options.query);
      if (!queryVector) {
        queryVector = await this.embeddings.embedQuery(options.query);
        this.embedding_cache.set(options.query, queryVector);
        
        // Periodic cleanup
        if (this.embedding_cache.size % 50 === 0) {
          this.cleanup_caches();
        }
      }
      
      let search = table.search(queryVector);

      if (options.filter) {
        const where_conditions = Object.entries(options.filter)
          .map(([key, value]) => {
            if (typeof value === "string") {
              // Handle simple equality
              return `${key} = '${value}'`;
            } else {
              // Handle complex operators like >=, <=, etc.
              return `${key} ${value.operator} '${value.value}'`;
            }
          })
          .join(" AND ");

        search = search.where(where_conditions);
      }
      results = await search.limit(options?.limit || 10).toArray();
    } else {
      // Regular search
      results = await table
        .query()
        .limit(options?.limit || 10)
        .toArray();
    }
    
    // Cache the results
    this.search_result_cache.set(cache_key, {
      results,
      timestamp: Date.now()
    });
    
    return results;
  }

  private async execute_get_operation(operation: Operation): Promise<SearchItem | null> {
    return await this.get(operation.namespace!, operation.key!);
  }

  private async execute_put_operation(operation: Operation): Promise<undefined> {
    await this.put(operation.namespace!, operation.key!, operation.value!);
    return undefined;
  }

  private async execute_delete_operation(operation: Operation): Promise<undefined> {
    await this.delete(operation.namespace!, operation.key!);
    return undefined;
  }

  private async execute_search_operation(operation: Operation): Promise<SearchItem[]> {
    return await this.search(operation.namespacePrefix!, {
      query: operation.query,
    });
  }

  private async execute_single_operation(operation: Operation): Promise<SearchItem | SearchItem[] | undefined> {
    const operationType = operation.type;
    switch (operationType) {
      case "get":
        return await this.execute_get_operation(operation);
      case "put":
        return await this.execute_put_operation(operation);
      case "delete":
        return await this.execute_delete_operation(operation);
      case "search":
        return await this.execute_search_operation(operation);
      default:
        throw new Error(`Unknown operation type: ${operationType}`);
    }
  }

  /**
   * Executes multiple operations atomically in sequence.
   * All operations must succeed, or the entire batch may fail.
   * 
   * @template Op - Array of specific Operation types
   * @param operations - Array of operations to execute
   * @returns Promise that resolves to array of results matching operation types
   * @throws {Error} If any operation fails
   * 
   * @example
   * ```typescript
   * const results = await store.batch([
   *   { type: 'get', namespace: ['docs'], key: 'doc-1' },
   *   { type: 'search', namespacePrefix: ['docs'], query: 'hello' },
   *   { type: 'put', namespace: ['docs'], key: 'doc-2', value: { content: 'new' } }
   * ]);
   * // results[0]: SearchItem | null (from get)
   * // results[1]: SearchItem[] (from search)
   * // results[2]: undefined (from put)
   * ```
   */
  async batch<Op extends Operation[]>(
    operations: Op
  ): Promise<OperationResults<Op>> {
    const results = [] as (SearchItem | SearchItem[] | undefined)[];

    for (const operation of operations) {
      const result = await this.execute_single_operation(operation);
      results.push(result);
    }

    return results as OperationResults<Op>;
  }

  /**
   * Removes an item from the specified namespace.
   * 
   * @param namespace - Array of strings defining the namespace path
   * @param key - Unique identifier of the item to delete
   * @returns Promise that resolves when the item is deleted
   * @throws {Error} If table access fails
   * 
   * @example
   * ```typescript
   * await store.delete(['documents'], 'doc-123');
   * ```
   */
  async delete(namespace: string[], key: string): Promise<void> {
    const table = await this.get_table(namespace);
    await table.delete(`key = '${key}'`);
  }

  /**
   * Lists all available namespaces in the database with optional filtering.
   * 
   * @param options - Optional filtering and pagination options
   * @param options.prefix - Only include namespaces starting with this prefix
   * @param options.suffix - Only include namespaces ending with this suffix
   * @param options.maxDepth - Maximum namespace depth to include
   * @param options.limit - Maximum number of namespaces to return
   * @param options.offset - Number of namespaces to skip (for pagination)
   * @returns Promise that resolves to array of namespace paths
   * @throws {Error} If table listing fails
   * 
   * @example
   * ```typescript
   * // Get all namespaces
   * const allNamespaces = await store.listNamespaces();
   * 
   * // Get namespaces starting with 'documents'
   * const docNamespaces = await store.listNamespaces({
   *   prefix: ['documents'],
   *   limit: 10
   * });
   * ```
   */
  async list_namespaces(options?: {
    prefix?: string[];
    suffix?: string[];
    maxDepth?: number;
    limit?: number;
    offset?: number;
  }): Promise<string[][]> {
    const namespaces = new Set<string[]>();

    // Get all tables from LanceDB
    const tables = await this.db.tableNames();

    for (const tableName of tables) {
      const parts = tableName.split("/");
      if (
        options?.prefix &&
        !parts.join("/").startsWith(options.prefix.join("/"))
      )
        continue;
      if (
        options?.suffix &&
        !parts.join("/").endsWith(options.suffix.join("/"))
      )
        continue;
      if (options?.maxDepth && parts.length > options.maxDepth) continue;

      namespaces.add(parts);
    }

    return Array.from(namespaces).slice(
      options?.offset || 0,
      options?.limit ? (options.offset || 0) + options.limit : undefined
    );
  }

  /**
   * Debug method to inspect table contents and schema.
   * Returns first 5 rows and logs schema information to console.
   * 
   * @param namespace - Namespace path of the table to inspect
   * @returns Promise that resolves to array of sample table rows
   * @throws {Error} If table access fails
   * 
   * @example
   * ```typescript
   * const sampleRows = await store.debug_table(['documents']);
   * console.log('Sample data:', sampleRows);
   * ```
   */
  async debug_table(namespace: string[]): Promise<unknown[]> {
    const table = await this.get_table(namespace);
    const results = await table.query().limit(5).toArray();
    console.log("Table schema:", table.schema);
    console.log("First 5 rows:", JSON.stringify(results, null, 2));
    return results;
  }

  /**
   * Starts the memory store connection (no-op for LanceDB as it's already connected).
   * Provided for interface compatibility.
   */
  start(): void {
    // LanceDB connection is already started in constructor
  }

  /**
   * Closes the database connection and cleans up resources.
   * Should be called when the memory store is no longer needed.
   * 
   * @example
   * ```typescript
   * await store.stop();
   * ```
   */
  stop(): void {
    // Performance optimization: Clean up caches before closing to free memory
    this.tableCache.clear();
    this.embedding_cache.clear();
    this.search_result_cache.clear();
    this.db.close();
  }
}

function get_value_string(value: Record<string, unknown>): string {
  return Object.values(value)
    .filter((v) => typeof v === "string")
    .join(" ");
}

async function create_note_descriptions_table(
  store: LanceDBMemoryStore,
  db: lancedb.Connection
): Promise<lancedb.Table> {
  const all_notes = await NoteTools.fetch_existing_notes();
  const all_note_strings = all_notes.map(
    (note) => get_value_string(note).slice(0, 1000) // There is a limit on the number of tokens that can be embedded
  );
  const all_note_embeddings = await store.embeddings.embedDocuments(
    all_note_strings
  );
  const values = all_notes.map((note, index) => {
    // Convert sections array to a delimited string
    const sectionsString = Array.isArray(note.sections)
      ? note.sections.join("|||")
      : String(note.sections || "");

    return {
      key: note.path,
      name: note.name,
      sections_string: sectionsString, // Store as string with delimiter
      description: note.description,
      path: note.path,
      body: note.body,
      created_at: note.created_at.toISOString(),
      updated_at: note.updated_at.toISOString(),
      vector: all_note_embeddings[index],
    };
  });

  const table = await db.createTable(
    MEMORY_NAMESPACES.NOTE_DESCRIPTIONS,
    values,
    {
      mode: "overwrite",
    }
  );
  return table;
}

/**
 * Retrieves notes that are semantically similar to the provided search string.
 * Uses vector embeddings to find the most relevant notes based on content similarity.
 * 
 * @param store - The LanceDBMemoryStore instance to search in
 * @param search_string - Text query to find similar notes for
 * @param limit - Maximum number of similar notes to return (default: 3)
 * @returns Promise that resolves to array of similar Note objects
 * @throws {Error} If search operation fails or note parsing errors occur
 * 
 * @example
 * ```typescript
 * const similarNotes = await retrieve_similar_notes(
 *   memoryStore,
 *   'machine learning algorithms',
 *   5
 * );
 * console.log(`Found ${similarNotes.length} similar notes`);
 * ```
 */
export async function retrieve_similar_notes(
  store: LanceDBMemoryStore,
  search_string: string,
  limit = 3
): Promise<Note[]> {
  const results = await store.search([MEMORY_NAMESPACES.NOTE_DESCRIPTIONS], {
    query: search_string,
    limit: limit * limit,
  });
  
  // Type for search results with note fields
  type NoteSearchResult = SearchItem & {
    name: string;
    sections_string?: string;
    description: string;
    path: string;
    body: string;
    created_at: string;
    updated_at: string;
    _distance: number;
  };
  
  const notes = results
    .map((r: SearchItem) => {
      const result = r as NoteSearchResult;
      // Convert the delimited string back to an array
      const sections = result.sections_string ? result.sections_string.split("|||") : [];

      try {
        const note = NoteSchema.parse({
          name: result.name,
          sections: sections,
          description: result.description,
          path: result.path,
          body: result.body,
          created_at: new Date(result.created_at),
          updated_at: new Date(result.updated_at),
        });
        return [note, result._distance, note.updated_at.getTime()];
      } catch (e) {
        console.log("Error parsing note:", e);
        return null;
      }
    })
    // Remove any null values that might have resulted from parsing errors
    .filter((item): item is [Note, number, number] => item !== null);

  if (notes.length === 0) {
    console.log("No valid notes found");
    return [];
  }

  const similar_notes = notes.map(([note]) => note).slice(0, limit);

  return similar_notes;
}

/**
 * Retrieves notes that are semantically similar to the search string with optional recency filtering.
 * Combines similarity scoring with temporal relevance to find the most appropriate notes.
 * 
 * @param store - The LanceDBMemoryStore instance to search in
 * @param search_string - Text query to find similar notes for
 * @param limit - Maximum number of similar notes to return (default: 3)
 * @param options - Optional filtering and scoring configuration
 * @param options.days_back - Only return notes from the last N days
 * @param options.min_date - Only return notes after this specific date
 * @param options.combine_scores - Whether to combine similarity and recency scores for ranking
 * @returns Promise that resolves to array of similar Note objects
 * @throws {Error} If search operation fails or note parsing errors occur
 * 
 * @example
 * ```typescript
 * // Get recent notes similar to query
 * const recentSimilar = await retrieve_similar_notes_with_recency(
 *   memoryStore,
 *   'project planning',
 *   5,
 *   { days_back: 30, combine_scores: true }
 * );
 * 
 * // Get notes after specific date
 * const dateFiltered = await retrieve_similar_notes_with_recency(
 *   memoryStore,
 *   'meeting notes',
 *   3,
 *   { min_date: new Date('2024-01-01') }
 * );
 * ```
 */
export async function retrieve_similar_notes_with_recency(
  store: LanceDBMemoryStore,
  search_string: string,
  limit = 3,
  options?: {
    days_back?: number; // Only return notes from the last N days
    min_date?: Date; // Only return notes after this date
    combine_scores?: boolean; // Whether to combine similarity and recency scores
  }
): Promise<Note[]> {
  const search_options: {
    query: string;
    limit: number;
    filter?: Record<string, string | { operator: string; value: string }>;
  } = {
    query: search_string,
    limit: limit * limit,
  };

  // Add time-based filter if specified
  if (options?.days_back) {
    const cutoff_date = new Date();
    cutoff_date.setDate(cutoff_date.getDate() - options.days_back);
    search_options.filter = {
      updated_at: { operator: ">=", value: cutoff_date.toISOString() },
    };
  } else if (options?.min_date) {
    search_options.filter = {
      updated_at: { operator: ">=", value: options.min_date.toISOString() },
    };
  }

  const results = await store.search(
    [MEMORY_NAMESPACES.NOTE_DESCRIPTIONS],
    search_options
  );

  type NoteWithMetrics = [Note, number, number];
  type SearchResultWithNoteFields = SearchItem & {
    name: string;
    sections_string?: string;
    description: string;
    path: string;
    body: string;
    created_at: string;
    updated_at: string;
    _distance: number;
  };

  const notes: NoteWithMetrics[] = results
    .map((r: SearchItem) => {
      const result = r as SearchResultWithNoteFields;
      const sections = result.sections_string
        ? result.sections_string.split("|||")
        : [];

      try {
        const note = NoteSchema.parse({
          name: result.name,
          sections: sections,
          description: result.description,
          path: result.path,
          body: result.body,
          created_at: new Date(result.created_at),
          updated_at: new Date(result.updated_at),
        });
        return [
          note,
          result._distance,
          note.updated_at.getTime(),
        ] as NoteWithMetrics;
      } catch (e) {
        console.log("Error parsing note:", e);
        return null;
      }
    })
    .filter((item): item is NoteWithMetrics => item !== null);

  if (notes.length === 0) {
    console.log("No valid notes found");
    return [];
  }

  // If combine_scores is true, re-rank based on both similarity and recency
  if (options?.combine_scores) {
    const now = Date.now();
    const max_age_ms = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

    notes.sort((a: NoteWithMetrics, b: NoteWithMetrics) => {
      const [, distance_a, timestamp_a] = a;
      const [, distance_b, timestamp_b] = b;

      // Normalize similarity score (lower distance is better, so invert)
      const similarity_a = 1 / (1 + distance_a);
      const similarity_b = 1 / (1 + distance_b);

      // Normalize recency score (more recent is better)
      const recency_a = Math.max(0, 1 - (now - timestamp_a) / max_age_ms);
      const recency_b = Math.max(0, 1 - (now - timestamp_b) / max_age_ms);

      // Combine scores (you can adjust weights as needed)
      const combined_a = 0.7 * similarity_a + 0.3 * recency_a;
      const combined_b = 0.7 * similarity_b + 0.3 * recency_b;

      return combined_b - combined_a; // Higher combined score is better
    });
  }

  return notes.map(([note]) => note).slice(0, limit);
}
