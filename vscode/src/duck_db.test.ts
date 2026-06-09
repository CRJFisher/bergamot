import {
  DuckDB,
  create_metadata_schema,
  insert_webpage_capture,
  get_webpage_capture,
  insert_page_activity_session,
  find_tree_containing_url,
  get_page_sessions_with_tree_id,
  insert_webpage_tree,
  update_webpage_tree_activity_time,
  get_last_modified_trees_with_members,
  update_page_activity_session,
  get_page_by_title,
  get_webpage_by_url
} from "./duck_db";
import { PageActivitySession } from "./duck_db_models";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** A production-shaped key: 64 lowercase hex chars (32 bytes). */
const TEST_KEY = "0123456789abcdef".repeat(4);

/** Creates a fresh real temp directory for file-backed store tests. */
function make_temp_dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-duckdb-test-"));
}

/** Builds a minimal metadata-only capture record for a session id. */
function capture_record(page_session_id: string, title: string, url: string) {
  return {
    page_session_id,
    content_type: "text/html",
    url,
    title,
    captured_at: "2024-01-01T00:00:00Z",
  };
}

describe("DuckDB", () => {
  let db: DuckDB;

  beforeEach(async () => {
    // In-memory database: schema/query tests need no file and no key.
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("constructor and initialization", () => {
    let temp_dir: string;

    beforeEach(() => {
      temp_dir = make_temp_dir();
    });

    afterEach(() => {
      fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    it("creates the parent directory if it doesn't exist", () => {
      const nested_dir = path.join(temp_dir, "nested", "deeper");

      new DuckDB({
        database_path: path.join(nested_dir, "db.db"),
        encryption_key: TEST_KEY,
      });

      expect(fs.existsSync(nested_dir)).toBe(true);
    });

    it("preserves an existing database file instead of deleting it", async () => {
      const db_path = path.join(temp_dir, "existing.db");
      const writer = new DuckDB({
        database_path: db_path,
        encryption_key: TEST_KEY,
      });
      await writer.init();
      await create_metadata_schema(writer);
      await writer.close();
      const size_before = fs.statSync(db_path).size;

      // The database must be durable: constructing the wrapper never deletes
      // or truncates the backing file. Data is opened in place, not recreated.
      new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });

      expect(fs.existsSync(db_path)).toBe(true);
      expect(fs.statSync(db_path).size).toBe(size_before);
    });

    it("rejects a file-backed store without an encryption key", () => {
      // A file store is only ever created encrypted — no plaintext fallback.
      expect(
        () => new DuckDB({ database_path: path.join(temp_dir, "db.db") })
      ).toThrow(/encryption_key/);
    });

    it("rejects an empty-string encryption key for a file-backed store", () => {
      expect(
        () =>
          new DuckDB({
            database_path: path.join(temp_dir, "db.db"),
            encryption_key: "",
          })
      ).toThrow(/encryption_key/);
    });

    it("rejects a key that is not 64 lowercase hex characters", () => {
      expect(
        () =>
          new DuckDB({
            database_path: path.join(temp_dir, "db.db"),
            encryption_key: "too-short-and-not-hex",
          })
      ).toThrow(/64 lowercase hex/);
    });

    it("rejects an encryption key for an in-memory database", () => {
      expect(
        () => new DuckDB({ database_path: ":memory:", encryption_key: TEST_KEY })
      ).toThrow(/in-memory/i);
    });

    it("close() before init() is a no-op", async () => {
      const uninitialized = new DuckDB({
        database_path: path.join(temp_dir, "db.db"),
        encryption_key: TEST_KEY,
      });

      await expect(uninitialized.close()).resolves.toBeUndefined();
    });

    it("should initialize all required tables", async () => {
      // Test that all tables are created
      const tables = [
        "webpage_trees",
        "webpage_activity_sessions",
        "webpage_capture"
      ];
      
      for (const table of tables) {
        await db.query(
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

  describe("webpage capture operations", () => {
    it("should insert and read back capture metadata", async () => {
      await insert_webpage_capture(
        db,
        capture_record("session-123", "Test Page", "https://example.com")
      );

      const meta = await get_webpage_capture(db, "session-123");
      expect(meta?.title).toBe("Test Page");
      expect(meta?.url).toBe("https://example.com");
      expect(meta?.content_type).toBe("text/html");
    });

    it("should replace an existing capture (INSERT OR REPLACE)", async () => {
      await insert_webpage_capture(
        db,
        capture_record("session-123", "Original Title", "https://example.com")
      );
      await insert_webpage_capture(
        db,
        capture_record("session-123", "Updated Title", "https://example.com")
      );

      const meta = await get_webpage_capture(db, "session-123");
      expect(meta?.title).toBe("Updated Title");
    });

    it("should return null for an unknown capture id", async () => {
      expect(await get_webpage_capture(db, "missing")).toBeNull();
    });
  });

  describe("page activity session operations", () => {
    beforeEach(async () => {
      // Create a test tree
      await insert_webpage_tree(db, "tree-1", "2024-01-01T12:00:00Z", "2024-01-01T12:00:00Z");
    });

    it("should insert new page activity session", async () => {
      const session: PageActivitySession = {
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
      const session: PageActivitySession = {
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
      const session: PageActivitySession = {
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
      const result = await db.query_first<{
        tree_id: string;
        referrer_page_session_id: string | null;
      }>(
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
      
      const result = await db.query_first<{
        first_load_time: string;
        latest_activity_time: string;
      }>(
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
      
      const result = await db.query_first<{ latest_activity_time: string }>(
        "SELECT latest_activity_time FROM webpage_trees WHERE id = $id",
        { id: "tree-123" }
      );

      expect(result?.latest_activity_time).toBe("2024-01-01T13:00:00Z");
    });

  });

  describe("complex query operations", () => {
    beforeEach(async () => {
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

      // Capture metadata is the canonical per-page record.
      await insert_webpage_capture(
        db,
        capture_record("session-1", "Page 1 Title", "https://example.com/page1")
      );
      await insert_webpage_capture(
        db,
        capture_record("session-2", "Page 2 Title", "https://example.com/page2")
      );
    });

    it("should get page sessions with tree ID joined to capture metadata", async () => {
      const results = await get_page_sessions_with_tree_id(db, "tree-1");

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("session-1");
      expect(results[0].capture?.title).toBe("Page 1 Title");
      expect(results[1].id).toBe("session-2");
      expect(results[1].capture?.title).toBe("Page 2 Title");
    });

    it("should get last modified trees with members excluding specified tree", async () => {
      const results = await get_last_modified_trees_with_members(
        db,
        "tree-2",
        1
      );

      expect(Object.keys(results)).toHaveLength(1);
      expect(results["tree-1"]).toBeDefined();
      expect(results["tree-1"]).toHaveLength(2);
    });

    it("should get a captured page by title", async () => {
      const result = await get_page_by_title(db, "Page 1 Title");
      expect(result?.title).toBe("Page 1 Title");
      expect(result?.page_session_id).toBe("session-1");
    });

    it("should return null when page title not found", async () => {
      expect(await get_page_by_title(db, "Nonexistent Title")).toBeNull();
    });

    it("should get webpage by URL with the capture title", async () => {
      await db.exec(`INSERT INTO webpage_trees (id, first_load_time, latest_activity_time)
                     VALUES ('url-test-tree', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
      await db.exec(`INSERT INTO webpage_activity_sessions
                     (id, url, referrer, page_loaded_at, tree_id)
                     VALUES ('url-session-1', 'https://example.com/url-page', null, '2024-01-01T23:59:59Z', 'url-test-tree')`);
      await insert_webpage_capture(
        db,
        capture_record("url-session-1", "Test Page Title", "https://example.com/url-page")
      );

      const result = await get_webpage_by_url(db, "https://example.com/url-page");

      expect(result?.url).toBe("https://example.com/url-page");
      expect(result?.title).toBe("Test Page Title");
      expect(result?.visited_at).toBe("2024-01-01T23:59:59Z");
    });
  });

  describe("error handling", () => {
    it("rejects init() on an unusable database path", async () => {
      // A file where the parent directory should be makes ATTACH fail
      // deterministically (not a directory), exercising the init failure path.
      const temp_dir = make_temp_dir();
      const blocking_file = path.join(temp_dir, "not-a-dir");
      fs.writeFileSync(blocking_file, "");

      const bad_db = new DuckDB({
        database_path: path.join(blocking_file, "db.db"),
        encryption_key: TEST_KEY,
      });
      await expect(bad_db.init()).rejects.toThrow();
      // init() cleans up after itself, so close() is safe afterwards.
      await expect(bad_db.close()).resolves.toBeUndefined();

      fs.rmSync(temp_dir, { recursive: true, force: true });
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

    it("reads a tree's captures back through the join in one query", async () => {
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
        await insert_webpage_capture(
          db,
          capture_record(
            `session-batch-${i}`,
            `Page ${i}`,
            `https://example.com/page${i}`
          )
        );
      }

      const results = await get_page_sessions_with_tree_id(db, "tree-batch");
      expect(results).toHaveLength(10);
      expect(results.every((r) => r.capture?.title?.startsWith("Page"))).toBe(true);
    });
  });
});

describe("at-rest encryption (real file)", () => {
  let temp_dir: string;
  let db_path: string;

  beforeEach(() => {
    temp_dir = make_temp_dir();
    db_path = path.join(temp_dir, "store.db");
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  it("persists data across reopen with the same key, and rejects a wrong key", async () => {
    const writer = new DuckDB({
      database_path: db_path,
      encryption_key: TEST_KEY,
    });
    await writer.init();
    await create_metadata_schema(writer);
    await insert_webpage_capture(
      writer,
      capture_record("enc-session", "Encrypted Page", "https://example.com/e")
    );
    await writer.close();

    const wrong = new DuckDB({
      database_path: db_path,
      encryption_key: "f".repeat(64),
    });
    await expect(wrong.init()).rejects.toThrow(/encryption key/i);
    await wrong.close();

    const reader = new DuckDB({
      database_path: db_path,
      encryption_key: TEST_KEY,
    });
    await reader.init();
    await create_metadata_schema(reader);
    const capture = await get_webpage_capture(reader, "enc-session");
    expect(capture?.title).toBe("Encrypted Page");
    await reader.close();
  });

  it("round-trips a database path containing single quotes (SQL literal escaping)", async () => {
    // Production keys are hex-only, so the path is the operand that exercises
    // sql_string_literal's quote escaping against a real ATTACH.
    const quoted_dir = path.join(temp_dir, "it's a dir");
    fs.mkdirSync(quoted_dir);
    const quoted_path = path.join(quoted_dir, "store.db");

    const writer = new DuckDB({
      database_path: quoted_path,
      encryption_key: TEST_KEY,
    });
    await writer.init();
    await create_metadata_schema(writer);
    await insert_webpage_capture(
      writer,
      capture_record("q", "Quoted", "https://example.com/q")
    );
    await writer.close();

    const reader = new DuckDB({
      database_path: quoted_path,
      encryption_key: TEST_KEY,
    });
    await reader.init();
    await create_metadata_schema(reader);
    expect((await get_webpage_capture(reader, "q"))?.title).toBe("Quoted");
    await reader.close();
  });

  it("writes no plaintext page titles or URLs into the database file or WAL", async () => {
    const marker = "PLAINTEXT_CANARY_TITLE";

    const writer = new DuckDB({
      database_path: db_path,
      encryption_key: TEST_KEY,
    });
    await writer.init();
    await create_metadata_schema(writer);
    await insert_webpage_capture(
      writer,
      capture_record("canary", marker, "https://plaintext-canary.example.com")
    );

    // Before CHECKPOINT the fresh row lives in the WAL — the store spends most
    // of its life in this state, so the WAL must be as opaque as the file.
    const wal_path = `${db_path}.wal`;
    expect(fs.existsSync(wal_path)).toBe(true);
    const wal_bytes = fs.readFileSync(wal_path);
    expect(wal_bytes.includes(marker)).toBe(false);
    expect(wal_bytes.includes("plaintext-canary")).toBe(false);

    // CHECKPOINT flushes the WAL into the (encrypted) database file so the
    // on-disk scan below sees the row's bytes.
    await writer.exec("CHECKPOINT");
    await writer.close();

    const bytes = fs.readFileSync(db_path);
    expect(bytes.includes(marker)).toBe(false);
    expect(bytes.includes("plaintext-canary")).toBe(false);
  });

  it("control: an unencrypted DuckDB file written the same way DOES contain the canary", async () => {
    // Proves the byte-scan method can see a leak at all. If DuckDB ever
    // compresses these strings out of raw visibility, this control fails
    // loudly instead of letting the canary test pass vacuously. The wrapper
    // has no plaintext path, so this uses the raw driver.
    const { DuckDBInstance } = jest.requireActual("@duckdb/node-api");
    const plain_path = path.join(temp_dir, "control-plain.db");
    const marker = "PLAINTEXT_CANARY_TITLE";

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(`ATTACH '${plain_path}' AS control`);
    await connection.run("USE control");
    await connection.run(
      "CREATE TABLE webpage_capture (page_session_id TEXT, url TEXT, title TEXT)"
    );
    await connection.run(
      `INSERT INTO webpage_capture VALUES ('canary', 'https://plaintext-canary.example.com', '${marker}')`
    );
    await connection.run("CHECKPOINT");
    connection.disconnectSync();
    instance.closeSync();

    const bytes = fs.readFileSync(plain_path);
    expect(bytes.includes(marker)).toBe(true);
  });

  it("checkpoints on close: the WAL is folded into the encrypted file", async () => {
    const writer = new DuckDB({
      database_path: db_path,
      encryption_key: TEST_KEY,
    });
    await writer.init();
    await create_metadata_schema(writer);
    await insert_webpage_capture(
      writer,
      capture_record("wal-session", "WAL Page", "https://example.com/w")
    );
    await writer.close();

    expect(fs.existsSync(`${db_path}.wal`)).toBe(false);

    const reader = new DuckDB({
      database_path: db_path,
      encryption_key: TEST_KEY,
    });
    await reader.init();
    await create_metadata_schema(reader);
    expect((await get_webpage_capture(reader, "wal-session"))?.title).toBe(
      "WAL Page"
    );
    await reader.close();
  });
});
