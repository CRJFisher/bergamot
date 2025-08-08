import {
  LanceDBMemoryStore,
  MEMORY_NAMESPACES,
  retrieve_similar_notes,
  retrieve_similar_notes_with_recency,
} from "./lance_db";
import { Embeddings } from "./workflow/embeddings";
import { NoteTools } from "./note_tools";
import { Note } from "./model_schema";
import * as lancedb from "@lancedb/lancedb";

// Mock dependencies
jest.mock("@lancedb/lancedb");
jest.mock("./note_tools");
jest.mock("./workflow/embeddings");

// Mock LanceDB components
const mockTable = {
  query: jest.fn().mockReturnThis(),
  search: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  add: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  toArray: jest.fn().mockResolvedValue([]),
  schema: { fields: [] },
};

const mockConnection = {
  openTable: jest.fn().mockResolvedValue(mockTable),
  createTable: jest.fn().mockResolvedValue(mockTable),
  tableNames: jest.fn().mockResolvedValue([]),
  close: jest.fn(),
};

const mockEmbeddings = {
  embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  embedDocuments: jest.fn().mockResolvedValue([
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
  ]),
} as jest.Mocked<Embeddings>;

// Mock lancedb
(lancedb.connect as jest.Mock).mockResolvedValue(mockConnection);

// Mock NoteTools
const mockNotes: Note[] = [
  {
    name: "Test Note 1",
    sections: ["section1", "section2"],
    description: "First test note",
    body: "Body of test note 1",
    path: "/path/to/note1.md",
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-02"),
  },
  {
    name: "Test Note 2",
    sections: ["section3"],
    description: "Second test note",
    body: "Body of test note 2",
    path: "/path/to/note2.md",
    created_at: new Date("2024-01-03"),
    updated_at: new Date("2024-01-04"),
  },
];

(NoteTools.fetch_existing_notes as jest.Mock).mockResolvedValue(mockNotes);

describe("LanceDBMemoryStore", () => {
  let store: LanceDBMemoryStore;
  const testDbPath = ":memory:";

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Reset mock implementations
    mockTable.query.mockReturnThis();
    mockTable.search.mockReturnThis();
    mockTable.where.mockReturnThis();
    mockTable.limit.mockReturnThis();
    mockTable.toArray.mockResolvedValue([]);

    mockConnection.tableNames.mockResolvedValue([]);
    mockConnection.openTable.mockResolvedValue(mockTable);
    mockConnection.createTable.mockResolvedValue(mockTable);
  });

  afterEach(() => {
    if (store) {
      store.stop();
    }
  });

  describe("create", () => {
    it("should create a new store instance with embeddings", async () => {
      store = await LanceDBMemoryStore.create(testDbPath, {
        embeddings: mockEmbeddings,
      });

      expect(lancedb.connect).toHaveBeenCalledWith(testDbPath);
      expect(store).toBeInstanceOf(LanceDBMemoryStore);
      expect(store.embeddings).toBe(mockEmbeddings);
    });

    it("should create a new store instance without embeddings", async () => {
      store = await LanceDBMemoryStore.create(testDbPath);

      expect(lancedb.connect).toHaveBeenCalledWith(testDbPath);
      expect(store).toBeInstanceOf(LanceDBMemoryStore);
      expect(store.embeddings).toBeUndefined();
    });

    it("should populate note descriptions table if it does not exist", async () => {
      mockConnection.tableNames.mockResolvedValue([]);

      store = await LanceDBMemoryStore.create(testDbPath, {
        embeddings: mockEmbeddings,
      });

      expect(NoteTools.fetch_existing_notes).toHaveBeenCalled();
      expect(mockEmbeddings.embedDocuments).toHaveBeenCalled();
      expect(mockConnection.createTable).toHaveBeenCalledWith(
        MEMORY_NAMESPACES.NOTE_DESCRIPTIONS,
        expect.any(Array),
        { mode: "overwrite" }
      );
    });

    it("should not populate note descriptions table if it already exists", async () => {
      mockConnection.tableNames.mockResolvedValue([
        MEMORY_NAMESPACES.NOTE_DESCRIPTIONS,
      ]);

      store = await LanceDBMemoryStore.create(testDbPath, {
        embeddings: mockEmbeddings,
      });

      expect(NoteTools.fetch_existing_notes).not.toHaveBeenCalled();
      expect(mockConnection.createTable).not.toHaveBeenCalled();
    });
  });

  describe("get", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath);
    });

    it("should retrieve an item by key", async () => {
      const mockResult = {
        key: "test-key",
        value: "test-value",
        created_at: "2024-01-01",
      };
      mockTable.toArray.mockResolvedValue([mockResult]);

      const result = await store.get(["test-namespace"], "test-key");

      expect(mockTable.query).toHaveBeenCalled();
      expect(mockTable.where).toHaveBeenCalledWith("key = 'test-key'");
      expect(result).toEqual(mockResult);
    });

    it("should return null when item not found", async () => {
      mockTable.toArray.mockResolvedValue([]);

      const result = await store.get(["test-namespace"], "nonexistent-key");

      expect(result).toBeNull();
    });

    it("should handle table opening errors", async () => {
      mockConnection.openTable.mockRejectedValue(new Error("Table not found"));

      await expect(
        store.get(["nonexistent-namespace"], "test-key")
      ).rejects.toThrow("Table not found");
    });
  });

  describe("put", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath, {
        embeddings: mockEmbeddings,
      });
    });

    it("should store an item with embeddings", async () => {
      const value = { title: "Test Document", content: "Test content" };

      await store.put(["test-namespace"], "test-key", value);

      expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith(
        "Test Document Test content"
      );
      expect(mockTable.add).toHaveBeenCalledWith([
        expect.objectContaining({
          key: "test-key",
          title: "Test Document",
          content: "Test content",
          vector: expect.any(Buffer),
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      ]);
    });

    it("should store an item without embeddings when no embeddings service available", async () => {
      store = await LanceDBMemoryStore.create(testDbPath);
      const value = { title: "Test Document" };

      await store.put(["test-namespace"], "test-key", value);

      expect(mockTable.add).toHaveBeenCalledWith([
        expect.objectContaining({
          key: "test-key",
          title: "Test Document",
          vector: null,
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      ]);
    });

    it("should handle sections array correctly", async () => {
      const value = {
        title: "Test Document",
        sections: ["section1", "section2", "section3"],
      };

      await store.put(["test-namespace"], "test-key", value);

      expect(mockTable.add).toHaveBeenCalledWith([
        expect.objectContaining({
          key: "test-key",
          title: "Test Document",
          sections_string: "section1|||section2|||section3",
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      ]);
    });

    it("should update timestamps correctly", async () => {
      const beforeTime = new Date().toISOString();
      const value = { title: "Test Document" };

      await store.put(["test-namespace"], "test-key", value);

      const afterTime = new Date().toISOString();
      const addCall = mockTable.add.mock.calls[0][0][0];

      expect(addCall.created_at >= beforeTime).toBeTruthy();
      expect(addCall.created_at <= afterTime).toBeTruthy();
      expect(addCall.updated_at >= beforeTime).toBeTruthy();
      expect(addCall.updated_at <= afterTime).toBeTruthy();
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath, {
        embeddings: mockEmbeddings,
      });
    });

    it("should perform vector search with query", async () => {
      const mockResults = [
        { key: "doc1", content: "content1", _distance: 0.1 },
        { key: "doc2", content: "content2", _distance: 0.2 },
      ];
      mockTable.toArray.mockResolvedValue(mockResults);

      const results = await store.search(["test-namespace"], {
        query: "test query",
        limit: 5,
      });

      expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith("test query");
      expect(mockTable.search).toHaveBeenCalledWith([0.1, 0.2, 0.3]);
      expect(mockTable.limit).toHaveBeenCalledWith(5);
      expect(results).toEqual(mockResults);
    });

    it("should perform vector search with filters", async () => {
      const mockResults = [{ key: "doc1", content: "content1" }];
      mockTable.toArray.mockResolvedValue(mockResults);

      const results = await store.search(["test-namespace"], {
        query: "test query",
        filter: {
          type: "document",
          confidence: { operator: ">=", value: "0.8" },
        },
      });

      expect(mockTable.where).toHaveBeenCalledWith(
        "type = 'document' AND confidence >= '0.8'"
      );
      expect(results).toEqual(mockResults);
    });

    it("should perform regular search without query", async () => {
      const mockResults = [{ key: "doc1", content: "content1" }];
      mockTable.toArray.mockResolvedValue(mockResults);

      const results = await store.search(["test-namespace"], { limit: 3 });

      expect(mockTable.query).toHaveBeenCalled();
      expect(mockTable.search).not.toHaveBeenCalled();
      expect(mockTable.limit).toHaveBeenCalledWith(3);
      expect(results).toEqual(mockResults);
    });

    it("should use default limit when not specified", async () => {
      mockTable.toArray.mockResolvedValue([]);

      await store.search(["test-namespace"]);

      expect(mockTable.limit).toHaveBeenCalledWith(10);
    });
  });

  describe("delete", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath);
    });

    it("should delete an item by key", async () => {
      await store.delete(["test-namespace"], "test-key");

      expect(mockTable.delete).toHaveBeenCalledWith("key = 'test-key'");
    });
  });

  describe("batch", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath, {
        embeddings: mockEmbeddings,
      });
    });

    it("should execute multiple operations in sequence", async () => {
      const getResult = { key: "key1", value: "value1" };
      const searchResults = [{ key: "key2", value: "value2" }];

      mockTable.toArray
        .mockResolvedValueOnce([getResult]) // for get operation
        .mockResolvedValueOnce(searchResults); // for search operation

      const operations = [
        { type: "get" as const, namespace: ["ns1"], key: "key1" },
        {
          type: "put" as const,
          namespace: ["ns2"],
          key: "key2",
          value: { data: "test" },
        },
        { type: "delete" as const, namespace: ["ns3"], key: "key3" },
        {
          type: "search" as const,
          namespacePrefix: ["ns4"],
          query: "search query",
        },
      ];

      const results = await store.batch(operations);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(getResult);
      expect(results[1]).toBeUndefined(); // put operation
      expect(results[2]).toBeUndefined(); // delete operation
      expect(results[3]).toEqual(searchResults);
    });

    it("should handle unknown operation type", async () => {
      const operations = [
        {
          type: "unknown" as "get" | "put" | "delete" | "search",
          namespace: ["ns1"],
        },
      ];

      await expect(store.batch(operations)).rejects.toThrow(
        "Unknown operation type: unknown"
      );
    });
  });

  describe("list_namespaces", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath);
    });

    it("should list all namespaces", async () => {
      mockConnection.tableNames.mockResolvedValue([
        "namespace1",
        "namespace2/subtable",
        "namespace3/level2/table",
      ]);

      const namespaces = await store.list_namespaces();

      expect(namespaces).toEqual([
        ["namespace1"],
        ["namespace2", "subtable"],
        ["namespace3", "level2", "table"],
      ]);
    });

    it("should filter by prefix", async () => {
      mockConnection.tableNames.mockResolvedValue([
        "test/table1",
        "test/table2",
        "other/table3",
      ]);

      const namespaces = await store.list_namespaces({ prefix: ["test"] });

      expect(namespaces).toEqual([
        ["test", "table1"],
        ["test", "table2"],
      ]);
    });

    it("should filter by suffix", async () => {
      mockConnection.tableNames.mockResolvedValue([
        "namespace1/data",
        "namespace2/data",
      ]);

      const namespaces = await store.list_namespaces({ suffix: ["data"] });

      expect(namespaces).toEqual([
        ["namespace1", "data"],
        ["namespace2", "data"],
      ]);
    });

    it("should limit depth", async () => {
      mockConnection.tableNames.mockResolvedValue([
        "level1",
        "level1/level2",
        "level1/level2/level3",
      ]);

      const namespaces = await store.list_namespaces({ maxDepth: 2 });

      expect(namespaces).toEqual([["level1"], ["level1", "level2"]]);
    });

    it("should apply limit and offset", async () => {
      mockConnection.tableNames.mockResolvedValue([
        "table1",
        "table2",
        "table3",
        "table4",
        "table5",
      ]);

      const namespaces = await store.list_namespaces({ limit: 2, offset: 1 });

      expect(namespaces).toHaveLength(2);
      expect(namespaces).toEqual([["table2"], ["table3"]]);
    });
  });

  describe("debug_table", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath);
    });

    it("should return debug information about table", async () => {
      const mockData = [
        { key: "key1", value: "value1" },
        { key: "key2", value: "value2" },
      ];
      mockTable.toArray.mockResolvedValue(mockData);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const result = await store.debug_table(["test-namespace"]);

      expect(mockTable.query).toHaveBeenCalled();
      expect(mockTable.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockData);
      expect(consoleSpy).toHaveBeenCalledWith("Table schema:", { fields: [] });
      expect(consoleSpy).toHaveBeenCalledWith(
        "First 5 rows:",
        JSON.stringify(mockData, null, 2)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("start and stop", () => {
    beforeEach(async () => {
      store = await LanceDBMemoryStore.create(testDbPath);
    });

    it("should handle start method", () => {
      // start() is a no-op for LanceDB, just ensure it doesn't throw
      expect(() => store.start()).not.toThrow();
    });

    it("should handle stop method", () => {
      store.stop();
      expect(mockConnection.close).toHaveBeenCalled();
    });
  });
});

describe("retrieve_similar_notes", () => {
  let store: LanceDBMemoryStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    store = await LanceDBMemoryStore.create(":memory:", {
      embeddings: mockEmbeddings,
    });
  });

  afterEach(() => {
    store.stop();
  });

  it("should retrieve and parse similar notes", async () => {
    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Test Note 1",
        sections_string: "section1|||section2",
        description: "First test note",
        path: "/path/to/note1.md",
        body: "Body of test note 1",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
        _distance: 0.1,
      },
      {
        key: "/path/to/note2.md",
        name: "Test Note 2",
        sections_string: "section3",
        description: "Second test note",
        path: "/path/to/note2.md",
        body: "Body of test note 2",
        created_at: "2024-01-03T00:00:00.000Z",
        updated_at: "2024-01-04T00:00:00.000Z",
        _distance: 0.2,
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);

    const result = await retrieve_similar_notes(store, "test search", 2);

    expect(store.search).toHaveBeenCalledWith(
      [MEMORY_NAMESPACES.NOTE_DESCRIPTIONS],
      { query: "test search", limit: 4 }
    );
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Test Note 1");
    expect(result[0].sections).toEqual(["section1", "section2"]);
    expect(result[1].name).toBe("Test Note 2");
    expect(result[1].sections).toEqual(["section3"]);
  });

  it("should handle notes with no sections string", async () => {
    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Test Note",
        sections_string: undefined,
        description: "Test note",
        path: "/path/to/note1.md",
        body: "Body",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
        _distance: 0.1,
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);

    const result = await retrieve_similar_notes(store, "test search", 1);

    expect(result).toHaveLength(1);
    expect(result[0].sections).toEqual([]);
  });

  it("should handle parsing errors gracefully", async () => {
    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Valid Note",
        sections_string: "section1",
        description: "Valid note",
        path: "/path/to/note1.md",
        body: "Body",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
        _distance: 0.1,
      },
      {
        key: "/path/to/note2.md",
        name: "Invalid Note",
        sections_string: "section2",
        description: "Invalid note",
        path: "/path/to/note2.md",
        body: "Body",
        created_at: "invalid-date", // This will cause parsing to fail
        updated_at: "2024-01-02T00:00:00.000Z",
        _distance: 0.2,
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await retrieve_similar_notes(store, "test search", 2);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Valid Note");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Error parsing note:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("should return empty array when no valid notes found", async () => {
    jest.spyOn(store, "search").mockResolvedValue([]);
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await retrieve_similar_notes(store, "test search");

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith("No valid notes found");

    consoleSpy.mockRestore();
  });
});

describe("retrieve_similar_notes_with_recency", () => {
  let store: LanceDBMemoryStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    store = await LanceDBMemoryStore.create(":memory:", {
      embeddings: mockEmbeddings,
    });
  });

  afterEach(() => {
    store.stop();
  });

  it("should retrieve notes with days_back filter", async () => {
    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Recent Note",
        sections_string: "section1",
        description: "Recent note",
        path: "/path/to/note1.md",
        body: "Body",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: new Date().toISOString(),
        _distance: 0.1,
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);

    const result = await retrieve_similar_notes_with_recency(
      store,
      "test search",
      1,
      { days_back: 7 }
    );

    expect(store.search).toHaveBeenCalledWith(
      [MEMORY_NAMESPACES.NOTE_DESCRIPTIONS],
      expect.objectContaining({
        query: "test search",
        limit: 1,
        filter: {
          updated_at: {
            operator: ">=",
            value: expect.any(String),
          },
        },
      })
    );
    expect(result).toHaveLength(1);
  });

  it("should retrieve notes with min_date filter", async () => {
    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Test Note",
        sections_string: "section1",
        description: "Test note",
        path: "/path/to/note1.md",
        body: "Body",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
        _distance: 0.1,
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);
    const minDate = new Date("2024-01-01");

    const result = await retrieve_similar_notes_with_recency(
      store,
      "test search",
      1,
      { min_date: minDate }
    );

    expect(store.search).toHaveBeenCalledWith(
      [MEMORY_NAMESPACES.NOTE_DESCRIPTIONS],
      expect.objectContaining({
        filter: {
          updated_at: {
            operator: ">=",
            value: minDate.toISOString(),
          },
        },
      })
    );
    expect(result).toHaveLength(1);
  });

  it("should combine similarity and recency scores", async () => {
    const now = Date.now();
    const recentTime = new Date(now - 1000 * 60 * 60 * 24).toISOString(); // 1 day ago
    const oldTime = new Date(now - 1000 * 60 * 60 * 24 * 20).toISOString(); // 20 days ago

    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Recent but less similar",
        sections_string: "section1",
        description: "Recent note",
        path: "/path/to/note1.md",
        body: "Body",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: recentTime,
        _distance: 0.8, // High distance = less similar
      },
      {
        key: "/path/to/note2.md",
        name: "Old but more similar",
        sections_string: "section2",
        description: "Old note",
        path: "/path/to/note2.md",
        body: "Body",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: oldTime,
        _distance: 0.1, // Low distance = more similar
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);

    const result = await retrieve_similar_notes_with_recency(
      store,
      "test search",
      2,
      { combine_scores: true }
    );

    expect(result).toHaveLength(2);
    // The order should be determined by combined score of similarity and recency
    expect(result[0]).toBeDefined();
    expect(result[1]).toBeDefined();
  });

  it("should handle empty results", async () => {
    jest.spyOn(store, "search").mockResolvedValue([]);
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await retrieve_similar_notes_with_recency(
      store,
      "test search"
    );

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith("No valid notes found");

    consoleSpy.mockRestore();
  });

  it("should handle parsing errors in recency function", async () => {
    const mockSearchResults = [
      {
        key: "/path/to/note1.md",
        name: "Invalid Note",
        sections_string: "section1",
        description: "Invalid note",
        path: "/path/to/note1.md",
        body: "Body",
        created_at: "invalid-date",
        updated_at: "2024-01-02T00:00:00.000Z",
        _distance: 0.1,
      },
    ];

    jest.spyOn(store, "search").mockResolvedValue(mockSearchResults);
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await retrieve_similar_notes_with_recency(
      store,
      "test search"
    );

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Error parsing note:",
      expect.any(Error)
    );
    expect(consoleSpy).toHaveBeenCalledWith("No valid notes found");

    consoleSpy.mockRestore();
  });
});
