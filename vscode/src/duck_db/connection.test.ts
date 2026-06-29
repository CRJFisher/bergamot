import { DuckDB } from "./connection";
import { LIST, FLOAT, listValue, DuckDBListValue } from "@duckdb/node-api";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TEST_KEY = "0123456789abcdef".repeat(4);

function make_temp_dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-duckdb-conn-test-"));
}

describe("DuckDB constructor", () => {
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
    const writer = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await writer.init();
    await writer.close();
    const size_before = fs.statSync(db_path).size;

    new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });

    expect(fs.existsSync(db_path)).toBe(true);
    expect(fs.statSync(db_path).size).toBe(size_before);
  });

  it("rejects a file-backed store without an encryption key", () => {
    expect(
      () => new DuckDB({ database_path: path.join(temp_dir, "db.db") })
    ).toThrow(/encryption_key/);
  });

  it("rejects an empty-string encryption key", () => {
    expect(
      () => new DuckDB({ database_path: path.join(temp_dir, "db.db"), encryption_key: "" })
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

  it("rejects init() on an unusable database path", async () => {
    const blocking_file = path.join(temp_dir, "not-a-dir");
    fs.writeFileSync(blocking_file, "");
    const bad_db = new DuckDB({
      database_path: path.join(blocking_file, "db.db"),
      encryption_key: TEST_KEY,
    });
    await expect(bad_db.init()).rejects.toThrow();
    await expect(bad_db.close()).resolves.toBeUndefined();
  });
});

describe("DuckDB query methods", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await db.exec("CREATE TABLE test_table (id TEXT PRIMARY KEY, val TEXT)");
  });

  afterEach(async () => {
    await db.close();
  });

  it("query returns all matching rows", async () => {
    await db.execute(
      "INSERT INTO test_table VALUES ($id, $val)",
      { id: "a", val: "x" }
    );
    await db.execute(
      "INSERT INTO test_table VALUES ($id, $val)",
      { id: "b", val: "y" }
    );
    const rows = await db.query<{ id: string }>("SELECT id FROM test_table ORDER BY id");
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("a");
    expect(rows[1].id).toBe("b");
  });

  it("query returns empty array when no rows match", async () => {
    const rows = await db.query("SELECT * FROM test_table WHERE id = $id", { id: "missing" });
    expect(rows).toEqual([]);
  });

  it("query_first returns the first row", async () => {
    await db.execute("INSERT INTO test_table VALUES ($id, $val)", { id: "a", val: "x" });
    const row = await db.query_first<{ id: string }>("SELECT id FROM test_table");
    expect(row?.id).toBe("a");
  });

  it("query_first returns null when no rows match", async () => {
    const row = await db.query_first("SELECT * FROM test_table WHERE id = $id", { id: "none" });
    expect(row).toBeNull();
  });

  it("execute runs a DML statement", async () => {
    await expect(
      db.execute("INSERT INTO test_table VALUES ($id, $val)", { id: "c", val: "z" })
    ).resolves.not.toThrow();
    const row = await db.query_first<{ val: string }>(
      "SELECT val FROM test_table WHERE id = $id",
      { id: "c" }
    );
    expect(row?.val).toBe("z");
  });

  it("create_table is idempotent", async () => {
    await expect(db.create_table("test_table", "id TEXT PRIMARY KEY")).resolves.not.toThrow();
  });

  it("exec runs a DDL statement without params", async () => {
    await expect(
      db.exec("CREATE INDEX IF NOT EXISTS idx_test ON test_table(val)")
    ).resolves.not.toThrow();
  });

  it("query rejects on invalid SQL", async () => {
    await expect(db.query("SELECT * FROM nonexistent_table")).rejects.toThrow();
  });

  it("execute threads explicit DuckDB types through, preserving fractional list values that inference would truncate", async () => {
    await db.exec("CREATE TABLE vec_test (id TEXT, vec FLOAT[])");
    // Leading element is integer-valued, so without an explicit FLOAT[] type
    // DuckDB infers INTEGER[] and truncates 0.5 -> 0.
    await db.execute(
      "INSERT INTO vec_test VALUES ($id, $vec)",
      { id: "a", vec: listValue([0, 0.5, 0.25]) },
      { vec: LIST(FLOAT) }
    );
    const row = await db.query_first<{ vec: DuckDBListValue }>(
      "SELECT vec FROM vec_test WHERE id = $id",
      { id: "a" }
    );
    expect(row!.vec.items.map(Number)).toEqual([0, 0.5, 0.25]);
  });
});

describe("DuckDB isolated_transaction", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await db.exec("CREATE TABLE txn_test (id TEXT PRIMARY KEY)");
  });

  afterEach(async () => {
    await db.close();
  });

  it("commits when fn resolves", async () => {
    await db.isolated_transaction(async (run) => {
      await run("INSERT INTO txn_test VALUES ($id)", { id: "committed" });
    });
    const row = await db.query_first<{ id: string }>(
      "SELECT id FROM txn_test WHERE id = $id",
      { id: "committed" }
    );
    expect(row?.id).toBe("committed");
  });

  it("rolls back when fn throws", async () => {
    await expect(
      db.isolated_transaction(async (run) => {
        await run("INSERT INTO txn_test VALUES ($id)", { id: "rolled-back" });
        throw new Error("intentional rollback");
      })
    ).rejects.toThrow("intentional rollback");

    const row = await db.query_first(
      "SELECT id FROM txn_test WHERE id = $id",
      { id: "rolled-back" }
    );
    expect(row).toBeNull();
  });

  it("commits on a file-backed store, pointing the dedicated connection at the attached catalog", async () => {
    const temp_dir = make_temp_dir();
    const file_db = new DuckDB({
      database_path: path.join(temp_dir, "txn.db"),
      encryption_key: TEST_KEY,
    });
    await file_db.init();
    await file_db.exec("CREATE TABLE file_txn (id TEXT PRIMARY KEY)");
    try {
      await file_db.isolated_transaction(async (run) => {
        await run("INSERT INTO file_txn VALUES ($id)", { id: "persisted" });
      });
      const row = await file_db.query_first<{ id: string }>(
        "SELECT id FROM file_txn WHERE id = $id",
        { id: "persisted" }
      );
      expect(row?.id).toBe("persisted");
    } finally {
      await file_db.close();
      fs.rmSync(temp_dir, { recursive: true, force: true });
    }
  });
});

describe("DuckDB at-rest encryption (real file)", () => {
  let temp_dir: string;
  let db_path: string;

  beforeEach(() => {
    temp_dir = make_temp_dir();
    db_path = path.join(temp_dir, "store.db");
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  it("persists data across reopen with the same key", async () => {
    const writer = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await writer.init();
    await writer.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
    await writer.execute("INSERT INTO t VALUES ($v)", { v: "hello" });
    await writer.close();

    const reader = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await reader.init();
    const row = await reader.query_first<{ v: string }>("SELECT v FROM t");
    expect(row?.v).toBe("hello");
    await reader.close();
  });

  it("rejects init() with a wrong encryption key", async () => {
    const writer = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await writer.init();
    await writer.close();

    const wrong = new DuckDB({ database_path: db_path, encryption_key: "f".repeat(64) });
    await expect(wrong.init()).rejects.toThrow(/encryption key/i);
    await wrong.close();
  });

  it("round-trips a database path containing single quotes", async () => {
    const quoted_dir = path.join(temp_dir, "it's a dir");
    fs.mkdirSync(quoted_dir);
    const quoted_path = path.join(quoted_dir, "store.db");

    const writer = new DuckDB({ database_path: quoted_path, encryption_key: TEST_KEY });
    await writer.init();
    await writer.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
    await writer.execute("INSERT INTO t VALUES ($v)", { v: "quoted" });
    await writer.close();

    const reader = new DuckDB({ database_path: quoted_path, encryption_key: TEST_KEY });
    await reader.init();
    expect((await reader.query_first<{ v: string }>("SELECT v FROM t"))?.v).toBe("quoted");
    await reader.close();
  });

  it("writes no plaintext string literals into the database file or WAL", async () => {
    const marker = "PLAINTEXT_CANARY_TITLE";

    const writer = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await writer.init();
    await writer.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
    await writer.execute("INSERT INTO t VALUES ($v)", { v: marker });

    // Before CHECKPOINT the fresh row lives in the WAL.
    const wal_path = `${db_path}.wal`;
    expect(fs.existsSync(wal_path)).toBe(true);
    const wal_bytes = fs.readFileSync(wal_path);
    expect(wal_bytes.includes(marker)).toBe(false);

    await writer.exec("CHECKPOINT");
    await writer.close();

    const bytes = fs.readFileSync(db_path);
    expect(bytes.includes(marker)).toBe(false);
  });

  it("control: an unencrypted DuckDB file DOES contain plaintext string literals", async () => {
    const { DuckDBInstance } = jest.requireActual("@duckdb/node-api");
    const plain_path = path.join(temp_dir, "control-plain.db");
    const marker = "PLAINTEXT_CANARY_TITLE";

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(`ATTACH '${plain_path}' AS control`);
    await connection.run("USE control");
    await connection.run("CREATE TABLE t (v TEXT)");
    await connection.run(`INSERT INTO t VALUES ('${marker}')`);
    await connection.run("CHECKPOINT");
    connection.disconnectSync();
    instance.closeSync();

    const bytes = fs.readFileSync(plain_path);
    expect(bytes.includes(marker)).toBe(true);
  });

  it("checkpoints on close: the WAL is folded into the encrypted file", async () => {
    const writer = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await writer.init();
    await writer.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
    await writer.execute("INSERT INTO t VALUES ($v)", { v: "wal-test" });
    await writer.close();

    expect(fs.existsSync(`${db_path}.wal`)).toBe(false);

    const reader = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    await reader.init();
    expect((await reader.query_first<{ v: string }>("SELECT v FROM t"))?.v).toBe("wal-test");
    await reader.close();
  });
});
