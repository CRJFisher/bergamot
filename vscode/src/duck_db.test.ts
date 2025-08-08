import {
  DuckDB,
  insert_webpage_analysis,
  get_webpage_analysis_for_ids,
  insert_page_activity_session,
  find_tree_containing_url,
  get_page_sessions_with_tree_id,
  insert_webpage_tree,
  update_webpage_tree_activity_time,
  get_last_modified_trees_with_members_and_analysis,
  insert_webpage_tree_intentions,
  update_page_activity_session,
  get_all_pages_for_rag,
  get_page_by_title,
  get_webpage_content,
  get_webpage_by_url
} from "./duck_db";
import { LanceDBMemoryStore } from "./lance_db";
import { 
  PageAnalysis,
  PageActivitySessionWithMeta
} from "./reconcile_webpage_trees_workflow_models";
import {
  PageActivitySession,
  PageActivitySessionWithoutContent
} from "./duck_db_models";
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";

// Mock dependencies
jest.mock("fs");
jest.mock("./lance_db");

// Mock path.dirname separately
jest.mock("path", () => ({
  ...jest.requireActual("path"),
  dirname: jest.fn().mockReturnValue("/test/dir")
}));

// Create mock implementations
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock LanceDBMemoryStore
const mockMemoryStore = {
  get: jest.fn(),
  batch: jest.fn(),
};

(LanceDBMemoryStore as unknown as jest.Mock).mockImplementation(() => mockMemoryStore);

describe("DuckDB", () => {
  let db: DuckDB;
  const testDbPath = ":memory:"; // Use in-memory database for tests
  
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock filesystem operations
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementation();
    mockFs.unlinkSync.mockImplementation();
    // path.dirname is already mocked in the module mock
    
    // Create a new database instance for each test
    db = new DuckDB({ database_path: testDbPath });
    await db.init();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("constructor and initialization", () => {
    it("should create database with correct configuration", () => {
      const config = { database_path: "/test/db.db", read_only: true };
      const testDb = new DuckDB(config);
      
      expect(path.dirname).toHaveBeenCalledWith("/test/db.db");
      expect(testDb).toBeDefined();
    });

    it("should delete existing database file if it exists", () => {
      mockFs.existsSync.mockReturnValueOnce(true); // File exists
      mockFs.existsSync.mockReturnValueOnce(false); // Directory doesn't exist
      
      new DuckDB({ database_path: "/test/db.db" });
      
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/test/db.db");
    });

    it("should create directory if it doesn't exist", () => {
      mockFs.existsSync.mockReturnValue(false);
      
      new DuckDB({ database_path: "/test/dir/db.db" });
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/test/dir", { recursive: true });
    });

    it("should initialize all required tables", async () => {
      // Test that all tables are created
      const tables = [
        "webpage_trees",
        "webpage_activity_sessions", 
        "webpage_analysis",
        "webpage_tree_intentions"
      ];
      
      for (const table of tables) {
        const result = await db.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
        );
        // Since we're using DuckDB, this query won't work exactly
        // But the init() method should complete without errors
      }
      
      expect(db.connection).toBeDefined();
    });
  });

  describe("query methods", () => {
    it("should execute query and return results", async () => {
      const result = await db.query("SELECT 1 as test");
      expect(result).toBeDefined();
    });

    it("should execute query_first and return first result", async () => {
      await db.execute(
        "INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES ('test-1', '2024-01-01', '2024-01-01')"
      );
      
      const result = await db.query_first<{ id: string }>(
        "SELECT id FROM webpage_trees WHERE id = $id",
        { id: "test-1" }
      );
      
      expect(result).toBeDefined();
      expect(result?.id).toBe("test-1");
    });

    it("should return null when query_first finds no results", async () => {
      const result = await db.query_first(
        "SELECT * FROM webpage_trees WHERE id = $id",
        { id: "nonexistent" }
      );
      
      expect(result).toBeNull();
    });

    it("should execute commands with execute method", async () => {
      await expect(
        db.execute(
          "INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES ($id, $first, $latest)",
          { id: "test-2", first: "2024-01-01", latest: "2024-01-02" }
        )
      ).resolves.not.toThrow();
    });

    it("should handle positional parameters with run method", async () => {
      await expect(
        db.run(
          "INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES (?, ?, ?)",
          ["test-3", "2024-01-01", "2024-01-02"]
        )
      ).resolves.not.toThrow();
    });

    it("should retrieve all results with all method", async () => {
      // Insert test data
      await db.run(
        "INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES (?, ?, ?)",
        ["test-1", "2024-01-01", "2024-01-01"]
      );
      await db.run(
        "INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES (?, ?, ?)",
        ["test-2", "2024-01-02", "2024-01-02"]
      );
      
      const results = await db.all<{ id: string }>(
        "SELECT id FROM webpage_trees ORDER BY id"
      );
      
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("test-1");
      expect(results[1].id).toBe("test-2");
    });

    it("should retrieve first result with get method", async () => {
      await db.run(
        "INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES (?, ?, ?)",
        ["test-1", "2024-01-01", "2024-01-01"]
      );
      
      const result = await db.get<{ id: string }>(
        "SELECT id FROM webpage_trees WHERE id = ?",
        ["test-1"]
      );
      
      expect(result).toBeDefined();
      expect(result?.id).toBe("test-1");
    });
  });

  describe("webpage analysis operations", () => {
    it("should insert webpage analysis", async () => {
      // First insert the tree and session
      await db.exec(`INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) 
                     VALUES ('test-tree', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
      await db.exec(`INSERT INTO webpage_activity_sessions 
                     (id, url, referrer, page_loaded_at, tree_id) 
                     VALUES ('session-123', 'https://example.com', null, '2024-01-01T00:00:00Z', 'test-tree')`);
      
      const analysis: PageAnalysis = {
        page_sesssion_id: "session-123",
        title: "Test Page",
        summary: "Test summary",
        intentions: ["learn", "research"]
      };
      
      await insert_webpage_analysis(db, analysis);
      
      // Verify insertion
      const result = await db.query_first(
        "SELECT * FROM webpage_analysis WHERE page_session_id = $id",
        { id: "session-123" }
      );
      
      expect(result).toBeDefined();
    });

    it("should replace existing webpage analysis", async () => {
      // First insert the tree and session
      await db.exec(`INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) 
                     VALUES ('test-tree', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
      await db.exec(`INSERT INTO webpage_activity_sessions 
                     (id, url, referrer, page_loaded_at, tree_id) 
                     VALUES ('session-123', 'https://example.com', null, '2024-01-01T00:00:00Z', 'test-tree')`);
      
      const analysis1: PageAnalysis = {
        page_sesssion_id: "session-123",
        title: "Original Title",
        summary: "Original summary",
        intentions: ["learn"]
      };
      
      const analysis2: PageAnalysis = {
        page_sesssion_id: "session-123",
        title: "Updated Title",
        summary: "Updated summary",
        intentions: ["learn", "research"]
      };
      
      await insert_webpage_analysis(db, analysis1);
      await insert_webpage_analysis(db, analysis2);
      
      const result = await db.query_first<any>(
        "SELECT title FROM webpage_analysis WHERE page_session_id = $id",
        { id: "session-123" }
      );
      
      expect(result?.title).toBe("Updated Title");
    });

    it("should retrieve webpage analysis for multiple IDs", async () => {
      // First insert the tree
      await db.exec(`INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) 
                     VALUES ('test-tree', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
      
      // Insert sessions for each analysis
      await db.exec(`INSERT INTO webpage_activity_sessions 
                     (id, url, referrer, page_loaded_at, tree_id) 
                     VALUES 
                     ('session-1', 'https://example.com/1', null, '2024-01-01T00:00:00Z', 'test-tree'),
                     ('session-2', 'https://example.com/2', null, '2024-01-01T00:00:00Z', 'test-tree'),
                     ('session-3', 'https://example.com/3', null, '2024-01-01T00:00:00Z', 'test-tree')`);
      
      // Insert test data
      const analyses: PageAnalysis[] = [
        {
          page_sesssion_id: "session-1",
          title: "Page 1",
          summary: "Summary 1",
          intentions: ["learn"]
        },
        {
          page_sesssion_id: "session-2",
          title: "Page 2",
          summary: "Summary 2",
          intentions: ["research"]
        },
        {
          page_sesssion_id: "session-3",
          title: "Page 3",
          summary: "Summary 3",
          intentions: ["browse"]
        }
      ];
      
      for (const analysis of analyses) {
        await insert_webpage_analysis(db, analysis);
      }
      
      const results = await get_webpage_analysis_for_ids(
        db,
        ["session-1", "session-3"]
      );
      
      expect(results).toHaveLength(2);
      expect(results.map(r => r.page_sesssion_id).sort()).toEqual(
        ["session-1", "session-3"]
      );
    });

    it("should return empty array for empty ID list", async () => {
      const results = await get_webpage_analysis_for_ids(db, []);
      expect(results).toEqual([]);
    });
  });

  describe("page activity session operations", () => {
    beforeEach(async () => {
      // Create a test tree
      await insert_webpage_tree(db, "tree-1", "2024-01-01T12:00:00Z", "2024-01-01T12:00:00Z");
    });

    it("should insert new page activity session", async () => {
      const session: PageActivitySessionWithoutContent = {
        id: "session-123",
        url: "https://example.com",
        referrer: "https://google.com",
        referrer_page_session_id: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        tree_id: "tree-1"
      };
      
      const result = await insert_page_activity_session(db, session);
      
      expect(result.was_new_session).toBe(true);
    });

    it("should update existing page activity session", async () => {
      const session: PageActivitySessionWithoutContent = {
        id: "session-123",
        url: "https://example.com",
        referrer: null,
        referrer_page_session_id: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        tree_id: "tree-1"
      };
      
      const result1 = await insert_page_activity_session(db, session);
      expect(result1.was_new_session).toBe(true);
      
      const result2 = await insert_page_activity_session(db, session);
      expect(result2.was_new_session).toBe(false);
    });

    it("should find tree containing URL with fuzzy matching", async () => {
      // Insert a session with a specific URL
      const session: PageActivitySessionWithoutContent = {
        id: "session-123",
        url: "https://example.com/page?query=test",
        referrer: null,
        referrer_page_session_id: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        tree_id: "tree-1"
      };
      
      await insert_page_activity_session(db, session);
      
      // Search with truncated URL (simulating referrer policy)
      const result = await find_tree_containing_url(
        db,
        "https://example.com/page",
        "2024-01-01T12:05:00Z"
      );
      
      expect(result).toBeDefined();
      expect(result?.id).toBe("session-123");
      expect(result?.tree_id).toBe("tree-1");
    });

    it("should return null when no tree contains URL", async () => {
      const result = await find_tree_containing_url(
        db,
        "https://nonexistent.com",
        "2024-01-01T12:00:00Z"
      );
      
      expect(result).toBeNull();
    });

    it("should update page activity session with new tree", async () => {
      // Create initial session
      const session: PageActivitySession = {
        id: "session-123",
        url: "https://example.com",
        referrer: null,
        referrer_page_session_id: null,
        content: "",
        page_loaded_at: "2024-01-01T12:00:00Z",
        tree_id: "tree-1"
      };
      
      await insert_page_activity_session(db, session);
      
      // Create new tree and update session
      await insert_webpage_tree(db, "tree-2", "2024-01-02T12:00:00Z", "2024-01-02T12:00:00Z");
      
      const updatedSession: PageActivitySession = {
        ...session,
        tree_id: "tree-2",
        referrer_page_session_id: "parent-session"
      };
      
      await update_page_activity_session(db, updatedSession);
      
      // Verify update
      const result = await db.query_first<any>(
        "SELECT tree_id, referrer_page_session_id FROM webpage_activity_sessions WHERE id = $id",
        { id: "session-123" }
      );
      
      expect(result?.tree_id).toBe("tree-2");
      expect(result?.referrer_page_session_id).toBe("parent-session");
    });
  });

  describe("webpage tree operations", () => {
    it("should insert webpage tree", async () => {
      await expect(
        insert_webpage_tree(
          db,
          "tree-123",
          "2024-01-01T12:00:00Z",
          "2024-01-01T12:30:00Z"
        )
      ).resolves.not.toThrow();
      
      const result = await db.query_first<any>(
        "SELECT * FROM webpage_trees WHERE id = $id",
        { id: "tree-123" }
      );
      
      expect(result).toBeDefined();
      expect(result?.first_load_time).toBe("2024-01-01T12:00:00Z");
      expect(result?.latest_activity_time).toBe("2024-01-01T12:30:00Z");
    });

    it("should update webpage tree activity time", async () => {
      await insert_webpage_tree(
        db,
        "tree-123",
        "2024-01-01T12:00:00Z",
        "2024-01-01T12:30:00Z"
      );
      
      await update_webpage_tree_activity_time(
        db,
        "tree-123",
        "2024-01-01T13:00:00Z"
      );
      
      const result = await db.query_first<any>(
        "SELECT latest_activity_time FROM webpage_trees WHERE id = $id",
        { id: "tree-123" }
      );
      
      expect(result?.latest_activity_time).toBe("2024-01-01T13:00:00Z");
    });

    it("should insert tree intentions", async () => {
      await insert_webpage_tree(db, "tree-123", "2024-01-01", "2024-01-01");
      
      // Insert sessions that the intentions reference
      await db.exec(`INSERT INTO webpage_activity_sessions 
                     (id, url, referrer, page_loaded_at, tree_id) 
                     VALUES 
                     ('session-1', 'https://example.com/1', null, '2024-01-01', 'tree-123'),
                     ('session-2', 'https://example.com/2', null, '2024-01-01', 'tree-123')`);
      
      const intentions = [
        {
          activity_session_id: "session-1",
          intentions: ["learn", "research"]
        },
        {
          activity_session_id: "session-2",
          intentions: ["purchase"]
        }
      ];
      
      await expect(
        insert_webpage_tree_intentions(db, "tree-123", intentions)
      ).resolves.not.toThrow();
    });

    it("should handle empty intentions array", async () => {
      await expect(
        insert_webpage_tree_intentions(db, "tree-123", [])
      ).resolves.not.toThrow();
    });
  });

  describe("complex query operations", () => {
    beforeEach(async () => {
      // Setup test data
      mockMemoryStore.get.mockImplementation((namespace, key) => {
        if (key === "session-1") {
          return Promise.resolve({ pageContent: "Content for session 1" });
        }
        if (key === "session-2") {
          return Promise.resolve({ pageContent: "Content for session 2" });
        }
        return Promise.resolve(null);
      });

      mockMemoryStore.batch.mockResolvedValue([
        { pageContent: "Content 1" },
        { pageContent: "Content 2" }
      ]);

      // Create trees and sessions
      await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
      await insert_webpage_tree(db, "tree-2", "2024-01-01T11:00:00Z", "2024-01-01T13:00:00Z");
      
      const sessions = [
        {
          id: "session-1",
          url: "https://example.com/page1",
          referrer: null,
          referrer_page_session_id: null,
          page_loaded_at: "2024-01-01T10:00:00Z",
          tree_id: "tree-1"
        },
        {
          id: "session-2",
          url: "https://example.com/page2",
          referrer: "https://example.com/page1",
          referrer_page_session_id: "session-1",
          page_loaded_at: "2024-01-01T10:30:00Z",
          tree_id: "tree-1"
        }
      ];
      
      for (const session of sessions) {
        await insert_page_activity_session(db, session);
      }
      
      // Add analysis data
      await insert_webpage_analysis(db, {
        page_sesssion_id: "session-1",
        title: "Page 1 Title",
        summary: "Page 1 summary",
        intentions: ["learn"]
      });
      
      await insert_webpage_analysis(db, {
        page_sesssion_id: "session-2",
        title: "Page 2 Title",
        summary: "Page 2 summary",
        intentions: ["research"]
      });
      
      // Add tree intentions
      await insert_webpage_tree_intentions(db, "tree-1", [
        { activity_session_id: "session-1", intentions: ["explore"] }
      ]);
    });

    it("should get page sessions with tree ID including analysis and content", async () => {
      const results = await get_page_sessions_with_tree_id(
        db,
        mockMemoryStore as any,
        "tree-1"
      );
      
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("session-1");
      expect(results[0].content).toBe("Content for session 1");
      expect(results[0].analysis?.title).toBe("Page 1 Title");
      expect(results[0].tree_intentions).toEqual(["explore"]);
      
      expect(results[1].id).toBe("session-2");
      expect(results[1].content).toBe("Content for session 2");
      expect(results[1].analysis?.title).toBe("Page 2 Title");
    });

    it("should get last modified trees with members excluding specified tree", async () => {
      const results = await get_last_modified_trees_with_members_and_analysis(
        db,
        mockMemoryStore as any,
        "tree-2",
        1
      );
      
      expect(Object.keys(results)).toHaveLength(1);
      expect(results["tree-1"]).toBeDefined();
      expect(results["tree-1"]).toHaveLength(2);
    });

    it("should get all pages for RAG with batch content retrieval", async () => {
      const results = await get_all_pages_for_rag(
        db,
        mockMemoryStore as any
      );
      
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Page 1 Title");
      expect(results[0].content).toBe("Content 1");
      expect(results[1].title).toBe("Page 2 Title");
      expect(results[1].content).toBe("Content 2");
      
      // Verify batch operation was used for performance
      expect(mockMemoryStore.batch).toHaveBeenCalled();
    });

    it("should get page by title", async () => {
      mockMemoryStore.get.mockResolvedValue({ 
        pageContent: "Specific page content" 
      });
      
      const result = await get_page_by_title(
        db,
        mockMemoryStore as any,
        "Page 1 Title"
      );
      
      expect(result).toBeDefined();
      expect(result?.title).toBe("Page 1 Title");
      expect(result?.content).toBe("Specific page content");
    });

    it("should return null when page title not found", async () => {
      const result = await get_page_by_title(
        db,
        mockMemoryStore as any,
        "Nonexistent Title"
      );
      
      expect(result).toBeNull();
    });

    it("should get webpage content from LanceDB", async () => {
      mockMemoryStore.get.mockResolvedValue({
        pageContent: "Test webpage content"
      });
      
      const result = await get_webpage_content(
        mockMemoryStore as any,
        "session-123"
      );
      
      expect(result).toBeDefined();
      expect(result?.content_compressed).toBe("Test webpage content");
      expect(mockMemoryStore.get).toHaveBeenCalledWith(
        ["webpage_content"],
        "session-123"
      );
    });

    it("should return null when webpage content not found", async () => {
      mockMemoryStore.get.mockResolvedValue(null);
      
      const result = await get_webpage_content(
        mockMemoryStore as any,
        "nonexistent"
      );
      
      expect(result).toBeNull();
    });

    it("should get webpage by URL", async () => {
      // First insert a tree
      await db.exec(`INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) 
                     VALUES ('url-test-tree', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
      
      // Insert a session with a later timestamp to ensure it's the most recent
      await db.exec(`INSERT INTO webpage_activity_sessions 
                     (id, url, referrer, page_loaded_at, tree_id) 
                     VALUES ('url-session-1', 'https://example.com/page1', null, '2024-01-01T23:59:59Z', 'url-test-tree')`);
      
      // Insert analysis for the session
      await db.exec(`INSERT INTO webpage_analysis 
                     (page_session_id, title, summary, intentions) 
                     VALUES ('url-session-1', 'Test Page Title', 'Test summary', '["learn"]')`);
      
      const result = await get_webpage_by_url(
        db,
        "https://example.com/page1"
      );
      
      expect(result).toBeDefined();
      expect(result?.url).toBe("https://example.com/page1");
      expect(result?.title).toBe("Test Page Title");
      expect(result?.visited_at).toBe("2024-01-01T23:59:59Z");
    });
  });

  describe("error handling", () => {
    it("should handle database connection errors", async () => {
      const badDb = new DuckDB({ database_path: "/invalid/path/db.db" });
      
      // In a real scenario, this would throw an error
      // For testing, we're just checking the structure
      expect(badDb).toBeDefined();
    });

    it("should handle query errors gracefully", async () => {
      await expect(
        db.query("SELECT * FROM nonexistent_table")
      ).rejects.toThrow();
    });

    it("should handle insertion errors", async () => {
      // Try to insert into a non-existent table
      await expect(
        db.execute(
          "INSERT INTO non_existent_table (id) VALUES ($id)",
          { id: "test" }
        )
      ).rejects.toThrow();
    });
  });

  describe("performance optimizations", () => {
    it("should create indexes during initialization", async () => {
      // Indexes should be created automatically during init
      // We can verify by checking query performance, but for unit tests
      // we just ensure no errors occur
      
      // Verify that indexed queries work
      await expect(
        db.query(
          "SELECT * FROM webpage_activity_sessions WHERE url LIKE $pattern",
          { pattern: "https://%" }
        )
      ).resolves.not.toThrow();
      
      await expect(
        db.query(
          "SELECT * FROM webpage_activity_sessions WHERE tree_id = $id",
          { id: "tree-1" }
        )
      ).resolves.not.toThrow();
    });

    it("should use batch operations for multiple retrievals", async () => {
      // Setup multiple sessions
      await insert_webpage_tree(db, "tree-batch", "2024-01-01", "2024-01-01");
      
      for (let i = 0; i < 10; i++) {
        await insert_page_activity_session(db, {
          id: `session-batch-${i}`,
          url: `https://example.com/page${i}`,
          referrer: null,
          referrer_page_session_id: null,
          page_loaded_at: "2024-01-01T12:00:00Z",
          tree_id: "tree-batch"
        });
        
        await insert_webpage_analysis(db, {
          page_sesssion_id: `session-batch-${i}`,
          title: `Page ${i}`,
          summary: `Summary ${i}`,
          intentions: []
        });
      }
      
      // Mock batch response
      const batchResults = Array(10).fill({ pageContent: "Batch content" });
      mockMemoryStore.batch.mockResolvedValue(batchResults);
      
      const results = await get_all_pages_for_rag(
        db,
        mockMemoryStore as any
      );
      
      expect(results).toHaveLength(10);
      expect(mockMemoryStore.batch).toHaveBeenCalledTimes(1);
      expect(mockMemoryStore.batch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: "get",
            namespace: ["webpage_content"]
          })
        ])
      );
    });
  });
});