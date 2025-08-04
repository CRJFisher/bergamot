import {
  SearchItem,
  Operation,
  OperationResults,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import { OpenAIEmbeddings } from "@langchain/openai";
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
 * LanceDB-based implementation of BaseStore for LangGraph
 * Provides persistent memory with vector search capabilities
 */
export class LanceDBMemoryStore extends BaseStore {
  private db: lancedb.Connection;
  private tableCache = new Map();
  public embeddings?: OpenAIEmbeddings;

  private constructor(
    db: lancedb.Connection,
    options?: { embeddings?: OpenAIEmbeddings }
  ) {
    super();
    this.db = db;
    this.embeddings = options?.embeddings;
  }

  static async create(
    dbPath: string,
    options?: { embeddings?: OpenAIEmbeddings }
  ): Promise<LanceDBMemoryStore> {
    const db = await lancedb.connect(dbPath);
    const store = new LanceDBMemoryStore(db, options);
    const namespaces = await store.listNamespaces();

    const should_populate_note_descriptions = !namespaces.some(
      (ns) => ns.join("_") === MEMORY_NAMESPACES.NOTE_DESCRIPTIONS
    );
    if (should_populate_note_descriptions) {
      const table = await create_note_descriptions_table(store, db);
      store.tableCache.set(MEMORY_NAMESPACES.NOTE_DESCRIPTIONS, table);
    }
    return store;
  }

  private async getTable(namespace: string[]): Promise<lancedb.Table> {
    const ns = namespace.join("_");
    if (this.tableCache.has(ns)) return this.tableCache.get(ns);

    try {
      // Try to open existing table first
      const table = await this.db.openTable(ns);
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

  async get(namespace: string[], key: string): Promise<SearchItem | null> {
    const table = await this.getTable(namespace);
    const results = await table.query().where(`key = '${key}'`).toArray();
    if (results.length === 0) return null;

    return results[0];
  }

  async put(
    namespace: string[],
    key: string,
    value: Record<string, any>,
    index?: false | string[] // TODO: implement indexing for improved performance
  ): Promise<void> {
    const table = await this.getTable(namespace);
    const now = new Date().toISOString();

    // Generate embedding if available
    let vector = null;
    if (this.embeddings) {
      const val_string = get_value_string(value);
      const embedding = await this.embeddings.embedQuery(val_string);
      vector = Buffer.from(new Float32Array(embedding).buffer);
    }

    // Handle sections consistently with our retrieval approach
    const flattenedRecord: Record<string, any> = {
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

  async search(
    namespacePrefix: string[],
    options?: {
      query?: string;
      limit?: number;
      filter?: Record<string, string | { operator: string; value: string }>;
    }
  ): Promise<SearchItem[]> {
    const table = await this.getTable(namespacePrefix);

    if (options?.query && this.embeddings) {
      // Vector search
      const queryVector = await this.embeddings.embedQuery(options.query);
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
      const results = await search.limit(options?.limit || 10).toArray();
      return results;
    } else {
      // Regular search
      const results = await table
        .query()
        .limit(options?.limit || 10)
        .toArray();
      return results;
    }
  }

  async batch<Op extends Operation[]>(
    operations: Op
  ): Promise<OperationResults<Op>> {
    const results = [] as any[];

    for (const operation of operations) {
      let result: SearchItem | SearchItem[] | undefined;
      const operationType = (operation as any).type;
      switch (operationType) {
        case "get":
          result = await this.get(
            (operation as any).namespace,
            (operation as any).key
          );
          break;
        case "put":
          await this.put(
            (operation as any).namespace,
            (operation as any).key,
            (operation as any).value
          );
          result = undefined;
          break;
        case "delete":
          await this.delete(
            (operation as any).namespace,
            (operation as any).key
          );
          result = undefined;
          break;
        case "search":
          result = await this.search((operation as any).namespacePrefix, {
            query: (operation as any).query,
          });
          break;
        default:
          throw new Error(`Unknown operation type: ${operationType}`);
      }
      results.push(result);
    }

    return results as OperationResults<Op>;
  }

  async delete(namespace: string[], key: string): Promise<void> {
    const table = await this.getTable(namespace);
    await table.delete(`key = '${key}'`);
  }

  async listNamespaces(options?: {
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

  // Debug method to inspect table contents
  async debug_table(namespace: string[]): Promise<any[]> {
    const table = await this.getTable(namespace);
    const results = await table.query().limit(5).toArray();
    console.log("Table schema:", table.schema);
    console.log("First 5 rows:", JSON.stringify(results, null, 2));
    return results;
  }

  start(): void {
    // LanceDB connection is already started in constructor
  }

  stop(): void {
    this.db.close();
  }
}

function get_value_string(value: Record<string, any>): string {
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

// Retrieve similar notes using vector search
export async function retrieve_similar_notes(
  store: LanceDBMemoryStore,
  search_string: string,
  limit = 3
): Promise<Note[]> {
  const results = await store.search([MEMORY_NAMESPACES.NOTE_DESCRIPTIONS], {
    query: search_string,
    limit: limit * limit,
  });
  const notes = results
    .map((r: any) => {
      // Convert the delimited string back to an array
      const sections = r.sections_string ? r.sections_string.split("|||") : [];

      try {
        const note = NoteSchema.parse({
          name: r.name,
          sections: sections,
          description: r.description,
          path: r.path,
          body: r.body,
          created_at: new Date(r.created_at),
          updated_at: new Date(r.updated_at),
        });
        return [note, r._distance, note.updated_at.getTime()];
      } catch (e) {
        console.log("Error parsing note:", e);
        return null;
      }
    })
    // Remove any null values that might have resulted from parsing errors
    .filter(Boolean);

  if (notes.length === 0) {
    console.log("No valid notes found");
    return [];
  }

  const similar_notes = notes.map(([note]) => note).slice(0, limit);

  return similar_notes;
}

// Retrieve similar notes using vector search with optional recency filter
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
