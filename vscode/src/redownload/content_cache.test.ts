import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDB } from "../duck_db";
import { CorpusContent } from "./corpus";
import { ContentCache, create_content_cache_schema } from "./content_cache";

/** A production-shaped key: 64 lowercase hex chars (32 bytes). */
const TEST_KEY = "fedcba9876543210".repeat(4);

function corpus_content(
  page_session_id: string,
  content: string,
  url = `https://example.com/${page_session_id}`
): CorpusContent {
  return {
    page_session_id,
    url,
    title: `Title of ${page_session_id}`,
    content,
    site_name: "Example",
    author: null,
    published_at: null,
    lang: "en",
    fetched_at: "2026-06-09T12:00:00Z",
    http_status: 200,
    content_hash: `hash-${page_session_id}`,
  };
}

describe("ContentCache (in-memory)", () => {
  let db: DuckDB;
  let cache: ContentCache;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_content_cache_schema(db);
    cache = new ContentCache(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("misses for an uncached page", async () => {
    expect(await cache.get("nope")).toBeNull();
  });

  it("round-trips a cached page", async () => {
    const content = corpus_content("p1", "<html>hello</html>");
    await cache.put(content, "tdt-run-1");

    const hit = await cache.get("p1");
    expect(hit).not.toBeNull();
    expect(hit?.content).toBe("<html>hello</html>");
    expect(hit?.url).toBe("https://example.com/p1");
    expect(hit?.http_status).toBe(200);
  });

  it("replaces the entry on re-cache (fresher fetch wins)", async () => {
    await cache.put(corpus_content("p1", "<html>old</html>"), "scope-a");
    await cache.put(corpus_content("p1", "<html>new</html>"), "scope-b");

    expect((await cache.get("p1"))?.content).toBe("<html>new</html>");
  });

  it("deletes a single item (right-to-forget primitive)", async () => {
    await cache.put(corpus_content("p1", "<html>one</html>"), "scope");
    await cache.put(corpus_content("p2", "<html>two</html>"), "scope");

    await cache.delete_item("p1");

    expect(await cache.get("p1")).toBeNull();
    expect(await cache.get("p2")).not.toBeNull();
  });

  it("deletes every item in a scope", async () => {
    await cache.put(corpus_content("p1", "<html>one</html>"), "project-x");
    await cache.put(corpus_content("p2", "<html>two</html>"), "project-x");
    await cache.put(corpus_content("p3", "<html>three</html>"), "project-y");

    await cache.delete_scope("project-x");

    expect(await cache.get("p1")).toBeNull();
    expect(await cache.get("p2")).toBeNull();
    expect(await cache.get("p3")).not.toBeNull();
  });
});

describe("ContentCache at-rest encryption (real file)", () => {
  let temp_dir: string;
  let db_path: string;

  beforeEach(() => {
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-cache-test-"));
    db_path = path.join(temp_dir, "content_cache.db");
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  async function open_cache(key: string): Promise<{ db: DuckDB; cache: ContentCache }> {
    const db = new DuckDB({ database_path: db_path, encryption_key: key });
    await db.init();
    await create_content_cache_schema(db);
    return { db, cache: new ContentCache(db) };
  }

  it("writes no plaintext page content into the cache file or WAL", async () => {
    const marker = "CACHE_PLAINTEXT_CANARY_BODY";
    const { db, cache } = await open_cache(TEST_KEY);
    await cache.put(
      corpus_content("canary", `<html><body>${marker}</body></html>`),
      "canary-scope"
    );

    // Fresh rows live in the WAL until checkpoint — it must be as opaque as
    // the file (put() does not checkpoint; delete does).
    const wal_path = `${db_path}.wal`;
    if (fs.existsSync(wal_path)) {
      const wal_bytes = fs.readFileSync(wal_path);
      expect(wal_bytes.includes(marker)).toBe(false);
    }

    await db.exec("CHECKPOINT");
    await db.close();

    const bytes = fs.readFileSync(db_path);
    expect(bytes.includes(marker)).toBe(false);
    expect(bytes.includes("Title of canary")).toBe(false);
  });

  it("persists across reopen with the same key and rejects a wrong key", async () => {
    const first = await open_cache(TEST_KEY);
    await first.cache.put(corpus_content("p1", "<html>persist</html>"), "s");
    await first.db.close();

    const wrong = new DuckDB({
      database_path: db_path,
      encryption_key: "0".repeat(64),
    });
    await expect(wrong.init()).rejects.toThrow(/encryption key/i);
    await wrong.close();

    const second = await open_cache(TEST_KEY);
    expect((await second.cache.get("p1"))?.content).toBe("<html>persist</html>");
    await second.db.close();
  });

  it("a deleted item's content is gone from the on-disk artifacts", async () => {
    const marker = "FORGOTTEN_CANARY_BODY";
    const { db, cache } = await open_cache(TEST_KEY);
    await cache.put(
      corpus_content("forget-me", `<html>${marker}</html>`),
      "scope"
    );
    await cache.delete_item("forget-me");
    await db.close();

    expect(await fs.promises.readFile(db_path).then((b) => b.includes(marker))).toBe(
      false
    );
    // The WAL was checkpointed away by the delete + close.
    expect(fs.existsSync(`${db_path}.wal`)).toBe(false);
  });
});
