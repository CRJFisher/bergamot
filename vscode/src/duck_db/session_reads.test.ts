import { DuckDB } from "./connection";
import { create_metadata_schema } from "./schema";
import {
  find_tree_containing_url,
  get_page_sessions_with_tree_id,
  get_last_modified_trees_with_members,
} from "./session_reads";
import {
  insert_webpage_tree,
  insert_page_activity_session,
} from "./session_writes";
import { insert_webpage_capture } from "./capture";

async function make_db(): Promise<DuckDB> {
  const db = new DuckDB({ database_path: ":memory:" });
  await db.init();
  await create_metadata_schema(db);
  return db;
}

function minimal_capture(id: string, title: string, url: string) {
  return {
    page_session_id: id,
    url,
    title,
    content_type: "text/html",
    captured_at: "2024-01-01T00:00:00Z",
  };
}

describe("find_tree_containing_url", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com/search?q=test",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T10:00:00Z",
      tree_id: "tree-1",
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("finds a session whose URL starts with the referrer prefix", async () => {
    // Referrer policy truncates cross-origin referrers to origin only.
    const result = await find_tree_containing_url(
      db,
      "https://example.com/search",
      "2024-01-01T10:05:00Z"
    );
    expect(result?.id).toBe("s1");
    expect(result?.tree_id).toBe("tree-1");
  });

  it("returns null when no URL matches the prefix", async () => {
    const result = await find_tree_containing_url(
      db,
      "https://nomatch.com",
      "2024-01-01T10:05:00Z"
    );
    expect(result).toBeNull();
  });

  it("picks the session closest in time to the new page visit", async () => {
    await insert_page_activity_session(db, {
      id: "s2",
      url: "https://example.com/search?q=other",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T09:00:00Z",
      tree_id: "tree-1",
    });
    // New page visited at 10:06 — s1 (10:00) is 6 min away, s2 (09:00) is 66 min away.
    const result = await find_tree_containing_url(
      db,
      "https://example.com/search",
      "2024-01-01T10:06:00Z"
    );
    expect(result?.id).toBe("s1");
  });
});

describe("get_page_sessions_with_tree_id", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://a.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T10:00:00Z",
      tree_id: "tree-1",
    });
    await insert_page_activity_session(db, {
      id: "s2",
      url: "https://b.com",
      referrer: "https://a.com",
      referrer_page_session_id: "s1",
      page_loaded_at: "2024-01-01T10:30:00Z",
      tree_id: "tree-1",
    });
    await insert_webpage_capture(db, minimal_capture("s1", "A", "https://a.com"));
    await insert_webpage_capture(db, minimal_capture("s2", "B", "https://b.com"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns all sessions belonging to the tree", async () => {
    const results = await get_page_sessions_with_tree_id(db, "tree-1");
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("preserves null and non-null referrer fields on each session", async () => {
    const results = await get_page_sessions_with_tree_id(db, "tree-1");
    const s1 = results.find((r) => r.id === "s1");
    const s2 = results.find((r) => r.id === "s2");
    expect(s1?.referrer).toBeNull();
    expect(s1?.referrer_page_session_id).toBeNull();
    expect(s2?.referrer).toBe("https://a.com");
    expect(s2?.referrer_page_session_id).toBe("s1");
  });

  it("joins the full capture metadata onto each session", async () => {
    const results = await get_page_sessions_with_tree_id(db, "tree-1");
    const s1 = results.find((r) => r.id === "s1");
    expect(s1?.capture).toEqual({
      page_session_id: "s1",
      url: "https://a.com",
      title: "A",
      content_type: "text/html",
      captured_at: "2024-01-01T00:00:00Z",
    });
  });

  it("returns capture as undefined when no capture exists for a session", async () => {
    await insert_page_activity_session(db, {
      id: "s3",
      url: "https://c.com",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:00:00Z",
      tree_id: "tree-1",
    });
    const results = await get_page_sessions_with_tree_id(db, "tree-1");
    const s3 = results.find((r) => r.id === "s3");
    expect(s3?.capture).toBeUndefined();
  });

  it("returns empty array for an unknown tree_id", async () => {
    const results = await get_page_sessions_with_tree_id(db, "ghost-tree");
    expect(results).toEqual([]);
  });
});

describe("get_last_modified_trees_with_members", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
    await insert_webpage_tree(db, "tree-1", "2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z");
    await insert_webpage_tree(db, "tree-2", "2024-01-01T11:00:00Z", "2024-01-01T13:00:00Z");
    await insert_webpage_tree(db, "tree-3", "2024-01-01T12:00:00Z", "2024-01-01T14:00:00Z");
    for (const [id, url, tree] of [
      ["s1", "https://a.com", "tree-1"],
      ["s2", "https://b.com", "tree-2"],
      ["s3", "https://c.com", "tree-3"],
    ] as const) {
      await insert_page_activity_session(db, {
        id,
        url,
        referrer: null,
        referrer_page_session_id: null,
        page_loaded_at: "2024-01-01T10:00:00Z",
        tree_id: tree,
      });
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it("excludes the specified tree from the result", async () => {
    const result = await get_last_modified_trees_with_members(db, "tree-3", 10);
    expect(Object.keys(result)).not.toContain("tree-3");
  });

  it("respects the limit parameter", async () => {
    const result = await get_last_modified_trees_with_members(db, "tree-3", 1);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("orders by latest_activity_time descending — limit=1 returns the most recently active", async () => {
    // tree-2 has latest_activity_time 13:00, tree-1 has 12:00.
    // Excluding tree-3, with limit=1, should return tree-2.
    const result = await get_last_modified_trees_with_members(db, "tree-3", 1);
    expect(Object.keys(result)).toContain("tree-2");
  });

  it("returns sessions grouped by tree_id", async () => {
    const result = await get_last_modified_trees_with_members(db, "tree-3", 2);
    expect(result["tree-1"]).toBeDefined();
    expect(result["tree-2"]).toBeDefined();
    expect(result["tree-1"][0].tree_id).toBe("tree-1");
    expect(result["tree-2"][0].tree_id).toBe("tree-2");
  });

  it("groups every member of a tree and orders them by page_loaded_at ascending", async () => {
    await insert_page_activity_session(db, {
      id: "s1-late",
      url: "https://a.com/late",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T11:30:00Z",
      tree_id: "tree-1",
    });
    await insert_page_activity_session(db, {
      id: "s1-early",
      url: "https://a.com/early",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T09:30:00Z",
      tree_id: "tree-1",
    });
    const result = await get_last_modified_trees_with_members(db, "tree-3", 10);
    expect(result["tree-1"].map((m) => m.id)).toEqual([
      "s1-early",
      "s1",
      "s1-late",
    ]);
  });

  it("returns empty object when all non-excluded trees are beyond the limit of 0", async () => {
    const result = await get_last_modified_trees_with_members(db, "tree-3", 0);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
