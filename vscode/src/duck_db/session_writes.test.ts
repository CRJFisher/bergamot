import { DuckDB } from "./connection";
import { create_metadata_schema } from "./schema";
import {
  insert_webpage_tree,
  update_webpage_tree_activity_time,
  insert_page_activity_session,
} from "./session_writes";
import { WEBPAGE_TREES_TABLE, WEBPAGE_ACTIVITY_SESSIONS_TABLE } from "./table_names";

async function make_db(): Promise<DuckDB> {
  const db = new DuckDB({ database_path: ":memory:" });
  await db.init();
  await create_metadata_schema(db);
  return db;
}

describe("insert_webpage_tree", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts a new tree with the given timestamps", async () => {
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    const row = await db.query_first<{ first_load_time: string; latest_activity_time: string }>(
      `SELECT first_load_time, latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: "tree-1" }
    );
    expect(row?.first_load_time).toBe("2024-01-01T10:00:00Z");
    expect(row?.latest_activity_time).toBe("2024-01-01T12:00:00Z");
  });

  it("is idempotent — inserting the same tree twice does not throw", async () => {
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    await expect(
      insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z")
    ).resolves.not.toThrow();
  });

  it("advances latest_activity_time on repeat insert with a later time", async () => {
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T14:00:00Z");
    const row = await db.query_first<{ latest_activity_time: string }>(
      `SELECT latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: "tree-1" }
    );
    expect(row?.latest_activity_time).toBe("2024-01-01T14:00:00Z");
  });

  it("does not roll back latest_activity_time when repeat insert has an earlier time", async () => {
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T14:00:00Z");
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T10:00:00Z");
    const row = await db.query_first<{ latest_activity_time: string }>(
      `SELECT latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: "tree-1" }
    );
    expect(row?.latest_activity_time).toBe("2024-01-01T14:00:00Z");
  });
});

describe("update_webpage_tree_activity_time", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
  });

  afterEach(async () => {
    await db.close();
  });

  it("advances the activity time to a later value", async () => {
    await update_webpage_tree_activity_time(db, "tree-1", "2024-01-01T15:00:00Z");
    const row = await db.query_first<{ latest_activity_time: string }>(
      `SELECT latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: "tree-1" }
    );
    expect(row?.latest_activity_time).toBe("2024-01-01T15:00:00Z");
  });

  it("is a no-op when the new time is not later than current", async () => {
    await update_webpage_tree_activity_time(db, "tree-1", "2024-01-01T10:00:00Z");
    const row = await db.query_first<{ latest_activity_time: string }>(
      `SELECT latest_activity_time FROM ${WEBPAGE_TREES_TABLE} WHERE id = $id`,
      { id: "tree-1" }
    );
    expect(row?.latest_activity_time).toBe("2024-01-01T12:00:00Z");
  });

  it("is a no-op (no throw) when the tree does not exist", async () => {
    await expect(
      update_webpage_tree_activity_time(db, "nonexistent-tree", "2024-01-01T15:00:00Z")
    ).resolves.not.toThrow();
  });
});

describe("insert_page_activity_session", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts a new session row and reports tree_changed=true", async () => {
    const result = await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-1",
    });
    expect(result.tree_changed).toBe(true);
    const row = await db.query_first<{ url: string; tree_id: string }>(
      `SELECT url, tree_id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} WHERE id = $id`,
      { id: "s1" }
    );
    expect(row?.url).toBe("https://example.com");
    expect(row?.tree_id).toBe("tree-1");
  });

  it("overwrites mutable fields when re-inserting an existing session", async () => {
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-1",
    });
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com/updated",
      referrer: "https://google.com",
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:30:00Z",
      tree_id: "tree-1",
    });
    const row = await db.query_first<{ url: string; referrer: string }>(
      `SELECT url, referrer FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} WHERE id = $id`,
      { id: "s1" }
    );
    expect(row?.url).toBe("https://example.com/updated");
    expect(row?.referrer).toBe("https://google.com");
  });

  it("reports tree_changed=false when re-inserting into the same tree", async () => {
    const session = {
      id: "s1",
      url: "https://example.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-1",
    };
    await insert_page_activity_session(db, session);
    const result = await insert_page_activity_session(db, session);
    expect(result.tree_changed).toBe(false);
  });

  it("reports tree_changed=true when the tree assignment changes", async () => {
    await insert_webpage_tree(db, "tree-2", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-1",
    });
    const result = await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-2",
    });
    expect(result.tree_changed).toBe(true);
  });

  it("stores referrer_page_session_id when provided", async () => {
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com",
      referrer: "https://google.com",
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-1",
    });
    await insert_page_activity_session(db, {
      id: "s2",
      url: "https://example.com/page2",
      referrer: "https://example.com",
      referrer_page_session_id: "s1",
      page_loaded_at: "2024-01-01T11:05:00Z",
      tree_id: "tree-1",
    });
    const row = await db.query_first<{ referrer_page_session_id: string }>(
      `SELECT referrer_page_session_id FROM ${WEBPAGE_ACTIVITY_SESSIONS_TABLE} WHERE id = $id`,
      { id: "s2" }
    );
    expect(row?.referrer_page_session_id).toBe("s1");
  });

  it("rejects a session pointing to a nonexistent tree", async () => {
    await expect(
      insert_page_activity_session(db, {
        id: "s-bad",
        url: "https://example.com",
        referrer: null,
        referrer_page_session_id: null,
        page_loaded_at: "2024-01-01T11:00:00Z",
        tree_id: "ghost-tree",
      })
    ).rejects.toThrow();
  });
});
