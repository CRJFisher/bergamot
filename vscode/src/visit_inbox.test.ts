import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { persist_visit, remove_visit, load_inbox } from "./visit_inbox";
import { ExtendedPageVisit } from "./visit_types";
import { DuckDB, create_metadata_schema, VISIT_INBOX_TABLE } from "./duck_db";

/** A production-shaped key: 64 lowercase hex chars (32 bytes). */
const TEST_KEY = "abcdef0123456789".repeat(4);

const make_visit = (id: string, url: string): ExtendedPageVisit => ({
  id,
  url,
  referrer: null,
  page_loaded_at: "2026-06-02T00:00:00.000Z",
  visit_id: `visit-${id}`,
  title: "Test page",
});

describe("visit_inbox", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("persists and reloads visits across a simulated restart", async () => {
    await persist_visit(db, make_visit("a", "https://a.com"));
    await persist_visit(db, make_visit("b", "https://b.com"));

    const reloaded = (await load_inbox(db)).sort((x, y) => x.id.localeCompare(y.id));
    expect(reloaded.map((v) => v.id)).toEqual(["a", "b"]);
    expect(reloaded[0].url).toBe("https://a.com");
    expect(reloaded[0].title).toBe("Test page");
  });

  it("removes a processed visit so it is not reloaded", async () => {
    await persist_visit(db, make_visit("a", "https://a.com"));
    await persist_visit(db, make_visit("b", "https://b.com"));

    await remove_visit(db, "a");

    expect((await load_inbox(db)).map((v) => v.id)).toEqual(["b"]);
  });

  it("drops and deletes a malformed entry missing required fields", async () => {
    await persist_visit(db, make_visit("good", "https://good.com"));
    // Insert a malformed entry directly — missing visit_id and title.
    const bad = { id: "legacy", url: "https://legacy.com", referrer: null, page_loaded_at: "2026-06-02T00:00:00.000Z" };
    await db.execute(
      `INSERT INTO ${VISIT_INBOX_TABLE} (id, url, page_loaded_at, visit_json)
       VALUES ($id, $url, $pl, $vj)`,
      { id: "legacy", url: "https://legacy.com", pl: "2026-06-02T00:00:00.000Z", vj: JSON.stringify(bad) }
    );

    const loaded = await load_inbox(db);
    expect(loaded.map((v) => v.id)).toEqual(["good"]);
    // The poison-pill row is removed so it cannot wedge the queue on restart.
    const remaining = await db.query<{ id: string }>(
      `SELECT id FROM ${VISIT_INBOX_TABLE} WHERE id = 'legacy'`
    );
    expect(remaining).toHaveLength(0);
  });

  it("returns an empty list for an empty inbox and tolerates double-remove", async () => {
    expect(await load_inbox(db)).toEqual([]);
    await expect(remove_visit(db, "never-existed")).resolves.toBeUndefined();
  });

  it("does not write any plaintext JSON file to disk during persist (AC#1)", async () => {
    // The inbox is a table inside the encrypted metadata store — no JSON files
    // are created in the storage directory at any point during ingest.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-ac1-"));
    const file_db = new DuckDB({ database_path: path.join(tmp, "test.db"), encryption_key: TEST_KEY });
    try {
      await file_db.init();
      await create_metadata_schema(file_db);
      await persist_visit(file_db, make_visit("x", "https://x.com/sensitive-path?token=abc123"));
      const json_files = fs.readdirSync(tmp).filter((f) => f.endsWith(".json"));
      expect(json_files).toHaveLength(0);
    } finally {
      await file_db.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("visit data is not readable as plaintext in the on-disk store bytes (AC#1 byte-scan)", async () => {
    // Verify that the URL does not appear as plaintext in the raw file bytes —
    // any file DuckDB writes (db, wal, tmp) should be ciphertext.
    const SENTINEL = "https://x.com/sensitive-path?token=abc123";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-ac1-bytes-"));
    const db_path = path.join(tmp, "test.db");
    const file_db = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
    try {
      await file_db.init();
      await create_metadata_schema(file_db);
      await persist_visit(file_db, make_visit("x", SENTINEL));
      // Checkpoint to fold the WAL into the main file before we scan.
      await file_db.exec("CHECKPOINT");
    } finally {
      await file_db.close();
    }
    const sentinel_buf = Buffer.from(SENTINEL);
    const all_files = fs.readdirSync(tmp).map((f) => path.join(tmp, f));
    for (const file_path of all_files) {
      const bytes = fs.readFileSync(file_path);
      expect(bytes.includes(sentinel_buf)).toBe(false);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("visits survive a close+reopen (AC#2 restart recovery)", async () => {
    // Simulates a real extension restart: persist to a file-backed encrypted DB,
    // close it, reopen with the same path+key, and verify load_inbox returns the visits.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-ac2-"));
    const db_path = path.join(tmp, "test.db");
    const open_db = () => {
      const d = new DuckDB({ database_path: db_path, encryption_key: TEST_KEY });
      return d;
    };

    // Session 1: persist visits, then close (simulating a crash before processing).
    const db1 = open_db();
    await db1.init();
    await create_metadata_schema(db1);
    await persist_visit(db1, make_visit("a", "https://a.com"));
    await persist_visit(db1, make_visit("b", "https://b.com"));
    await db1.close();

    // Session 2: reopen and verify restart recovery.
    const db2 = open_db();
    await db2.init();
    await create_metadata_schema(db2);
    const reloaded = (await load_inbox(db2)).sort((x, y) => x.id.localeCompare(y.id));
    expect(reloaded.map((v) => v.id)).toEqual(["a", "b"]);

    // Remove one and verify exactly-once: a third open should not re-surface it.
    await remove_visit(db2, "a");
    await db2.close();

    const db3 = open_db();
    await db3.init();
    await create_metadata_schema(db3);
    const after_remove = await load_inbox(db3);
    expect(after_remove.map((v) => v.id)).toEqual(["b"]);
    await db3.close();

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
