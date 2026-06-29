import { DuckDB } from "./connection";
import { create_metadata_schema } from "./schema";
import {
  insert_webpage_capture,
  get_webpage_capture,
  list_capture_targets,
  get_page_by_title,
  get_webpage_by_url,
  insert_webpage_fetch,
  get_latest_webpage_fetch,
} from "./capture";
import { insert_webpage_tree } from "./session_writes";
import { insert_page_activity_session } from "./session_writes";
import { WebpageFetch } from "../page_capture_models";

async function make_db(): Promise<DuckDB> {
  const db = new DuckDB({ database_path: ":memory:" });
  await db.init();
  await create_metadata_schema(db);
  return db;
}

function minimal_capture(
  page_session_id: string,
  title: string,
  url: string
) {
  return {
    page_session_id,
    url,
    title,
    content_type: "text/html",
    captured_at: "2024-01-01T00:00:00Z",
  };
}

describe("insert_webpage_capture / get_webpage_capture", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
  });

  afterEach(async () => {
    await db.close();
  });

  it("round-trips capture metadata", async () => {
    await insert_webpage_capture(db, minimal_capture("s1", "My Page", "https://example.com"));
    const result = await get_webpage_capture(db, "s1");
    expect(result?.title).toBe("My Page");
    expect(result?.url).toBe("https://example.com");
    expect(result?.content_type).toBe("text/html");
    expect(result?.page_session_id).toBe("s1");
  });

  it("returns null for an unknown page_session_id", async () => {
    expect(await get_webpage_capture(db, "missing")).toBeNull();
  });

  it("upserts — a second insert with the same id replaces the title", async () => {
    await insert_webpage_capture(db, minimal_capture("s1", "Original", "https://example.com"));
    await insert_webpage_capture(db, minimal_capture("s1", "Updated", "https://example.com"));
    const result = await get_webpage_capture(db, "s1");
    expect(result?.title).toBe("Updated");
  });

  it("stores multiple distinct sessions independently", async () => {
    await insert_webpage_capture(db, minimal_capture("s1", "Alpha", "https://alpha.com"));
    await insert_webpage_capture(db, minimal_capture("s2", "Beta", "https://beta.com"));
    expect((await get_webpage_capture(db, "s1"))?.title).toBe("Alpha");
    expect((await get_webpage_capture(db, "s2"))?.title).toBe("Beta");
  });
});

describe("list_capture_targets", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty array when no captures exist", async () => {
    expect(await list_capture_targets(db)).toEqual([]);
  });

  it("returns page_session_id and url for every capture", async () => {
    await insert_webpage_capture(db, minimal_capture("s1", "A", "https://a.com"));
    await insert_webpage_capture(db, minimal_capture("s2", "B", "https://b.com"));
    const targets = await list_capture_targets(db);
    expect(targets).toHaveLength(2);
    const ids = targets.map((t) => t.page_session_id).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });
});

describe("get_page_by_title", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns a capture matching the exact title", async () => {
    await insert_webpage_capture(db, minimal_capture("s1", "Exact Title", "https://example.com"));
    const result = await get_page_by_title(db, "Exact Title");
    expect(result?.page_session_id).toBe("s1");
    expect(result?.title).toBe("Exact Title");
  });

  it("returns null when no capture has that title", async () => {
    expect(await get_page_by_title(db, "No Such Title")).toBeNull();
  });

  it("does not match on partial title", async () => {
    await insert_webpage_capture(db, minimal_capture("s1", "Full Title Here", "https://x.com"));
    expect(await get_page_by_title(db, "Full Title")).toBeNull();
  });
});

describe("get_webpage_by_url", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns url, title, and visited_at for a known URL", async () => {
    await insert_webpage_tree(db, "t1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com/page",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T10:00:00Z",
      tree_id: "t1",
    });
    await insert_webpage_capture(db, minimal_capture("s1", "Page Title", "https://example.com/page"));

    const result = await get_webpage_by_url(db, "https://example.com/page");
    expect(result?.url).toBe("https://example.com/page");
    expect(result?.title).toBe("Page Title");
    expect(result?.visited_at).toBe("2024-01-01T10:00:00Z");
  });

  it("returns the most recent visit when a URL has multiple sessions", async () => {
    await insert_webpage_tree(db, "t1", "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z");
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com/page",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T10:00:00Z",
      tree_id: "t1",
    });
    await insert_page_activity_session(db, {
      id: "s2",
      url: "https://example.com/page",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-02T10:00:00Z",
      tree_id: "t1",
    });

    const result = await get_webpage_by_url(db, "https://example.com/page");
    expect(result?.visited_at).toBe("2024-01-02T10:00:00Z");
  });

  it("returns null for an unknown URL", async () => {
    expect(await get_webpage_by_url(db, "https://unknown.com")).toBeNull();
  });

  it("returns an empty title when no capture exists for the session", async () => {
    await insert_webpage_tree(db, "t1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    await insert_page_activity_session(db, {
      id: "s1",
      url: "https://example.com/no-capture",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2024-01-01T10:00:00Z",
      tree_id: "t1",
    });
    const result = await get_webpage_by_url(db, "https://example.com/no-capture");
    expect(result?.title).toBe("");
  });
});

describe("insert_webpage_fetch / get_latest_webpage_fetch", () => {
  let db: DuckDB;

  const base_fetch: WebpageFetch = {
    page_session_id: "s1",
    url: "https://example.com",
    final_url: "https://example.com",
    outcome: "ok",
    http_status: 200,
    content_hash: "abc123",
    content_type: "text/html",
    author: null,
    published_at: null,
    lang: "en",
    site_name: null,
    fetched_at: "2024-01-01T10:00:00Z",
  };

  beforeEach(async () => {
    db = await make_db();
  });

  afterEach(async () => {
    await db.close();
  });

  it("round-trips a fetch record", async () => {
    await insert_webpage_fetch(db, base_fetch);
    const result = await get_latest_webpage_fetch(db, "s1");
    expect(result?.outcome).toBe("ok");
    expect(result?.http_status).toBe(200);
    expect(result?.content_hash).toBe("abc123");
    expect(result?.lang).toBe("en");
  });

  it("returns null when no fetch exists for a session", async () => {
    expect(await get_latest_webpage_fetch(db, "nonexistent")).toBeNull();
  });

  it("is idempotent — inserting the same fetch twice stores only one row", async () => {
    await insert_webpage_fetch(db, base_fetch);
    await insert_webpage_fetch(db, base_fetch);
    const rows = await db.query(
      "SELECT fetch_id FROM webpage_fetch WHERE page_session_id = $id",
      { id: "s1" }
    );
    expect(rows).toHaveLength(1);
  });

  it("get_latest_webpage_fetch returns the most recent fetch", async () => {
    await insert_webpage_fetch(db, base_fetch);
    await insert_webpage_fetch(db, {
      ...base_fetch,
      fetched_at: "2024-01-02T10:00:00Z",
      content_hash: "def456",
    });
    const result = await get_latest_webpage_fetch(db, "s1");
    expect(result?.fetched_at).toBe("2024-01-02T10:00:00Z");
    expect(result?.content_hash).toBe("def456");
  });

  it("appends a separate row when content drifts at the same timestamp", async () => {
    await insert_webpage_fetch(db, base_fetch);
    await insert_webpage_fetch(db, { ...base_fetch, content_hash: "drifted" });
    const rows = await db.query(
      "SELECT fetch_id FROM webpage_fetch WHERE page_session_id = $id",
      { id: "s1" }
    );
    expect(rows).toHaveLength(2);
  });

  it("stores null optional fields as null", async () => {
    await insert_webpage_fetch(db, {
      ...base_fetch,
      final_url: null,
      http_status: null,
      content_hash: null,
      content_type: null,
      author: null,
      published_at: null,
      lang: null,
      site_name: null,
    });
    const result = await get_latest_webpage_fetch(db, "s1");
    expect(result?.final_url).toBeNull();
    expect(result?.http_status).toBeNull();
    expect(result?.content_hash).toBeNull();
    expect(result?.lang).toBeNull();
  });
});
