import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBValue } from "@duckdb/node-api";
import {
  DuckDB,
  create_metadata_schema,
  get_webpage_capture,
  insert_page_activity_session,
  insert_webpage_capture,
  insert_webpage_fetch,
  insert_webpage_tree,
  get_latest_webpage_fetch,
} from "./duck_db";
import {
  ContentCache,
  create_content_cache_schema,
} from "./redownload/content_cache";
import { CorpusContent } from "./redownload/corpus";
import { forget } from "./right_to_forget";

/** A production-shaped key: 64 lowercase hex chars (32 bytes). */
const TEST_KEY = "abcdef0123456789".repeat(4);

/** DuckDB that throws on any statement matching `poison` (when set). */
class PoisonableDuckDB extends DuckDB {
  poison: RegExp | null = null;

  private check(sql: string): void {
    if (this.poison && this.poison.test(sql)) {
      throw new Error(`poisoned: ${sql.slice(0, 60)}`);
    }
  }

  async execute(
    sql: string,
    params: Record<string, DuckDBValue> = {}
  ): Promise<void> {
    this.check(sql);
    return super.execute(sql, params);
  }

  async exec(sql: string): Promise<void> {
    this.check(sql);
    return super.exec(sql);
  }

  async isolated_transaction(
    fn: (
      run: (sql: string, params?: Record<string, DuckDBValue>) => Promise<void>
    ) => Promise<void>
  ): Promise<void> {
    return super.isolated_transaction(async (run) => {
      await fn(async (sql, params) => {
        this.check(sql);
        await run(sql, params);
      });
    });
  }
}

/** Cache whose batch delete always fails — pins cache-first ordering. */
class PoisonedCache extends ContentCache {
  async delete_items(): Promise<void> {
    throw new Error("cache down");
  }
}

function cached(page_session_id: string, url: string): CorpusContent {
  return {
    page_session_id,
    url,
    title: `Title ${page_session_id}`,
    content: `<html>content of ${page_session_id}</html>`,
    site_name: null,
    author: null,
    published_at: null,
    lang: null,
    fetched_at: "2026-06-09T12:00:00Z",
    http_status: 200,
    content_hash: `hash-${page_session_id}`,
  };
}

describe("right-to-forget cascade", () => {
  let metadata_db: PoisonableDuckDB;
  let cache_db: DuckDB;
  let cache: ContentCache;
  let seeded_trees: Set<string>;

  /**
   * Seeds one full visit: tree, activity session, capture row, fetch-log row,
   * and a cached content entry. Each tree is inserted only once — updating a
   * tree row that sessions already reference trips DuckDB's foreign-key
   * UPDATE limitation, which is unrelated to what these tests pin.
   */
  async function seed_visit(
    id: string,
    url: string,
    loaded_at: string,
    tree_id = `tree-${id}`,
    referrer: { url: string; id: string } | null = null
  ): Promise<void> {
    if (!seeded_trees.has(tree_id)) {
      await insert_webpage_tree(metadata_db, tree_id, loaded_at, loaded_at);
      seeded_trees.add(tree_id);
    }
    await insert_page_activity_session(metadata_db, {
      id,
      url,
      referrer: referrer?.url ?? null,
      referrer_page_session_id: referrer?.id ?? null,
      page_loaded_at: loaded_at,
      tree_id,
    });
    await insert_webpage_capture(metadata_db, {
      page_session_id: id,
      url,
      title: `Title ${id}`,
      content_type: "text/html",
      captured_at: loaded_at,
    });
    await insert_webpage_fetch(metadata_db, {
      page_session_id: id,
      url,
      final_url: url,
      outcome: "ok",
      http_status: 200,
      content_hash: `hash-${id}`,
      content_type: "text/html",
      author: null,
      published_at: null,
      lang: null,
      site_name: null,
      fetched_at: loaded_at,
    });
    await cache.put(cached(id, url), "test-scope");
  }

  async function session_count(): Promise<number> {
    const row = await metadata_db.query_first<{ n: unknown }>(
      "SELECT count(*)::INTEGER AS n FROM webpage_activity_sessions"
    );
    return Number(row?.n);
  }

  async function tree_count(): Promise<number> {
    const row = await metadata_db.query_first<{ n: unknown }>(
      "SELECT count(*)::INTEGER AS n FROM webpage_trees"
    );
    return Number(row?.n);
  }

  beforeEach(async () => {
    seeded_trees = new Set();
    metadata_db = new PoisonableDuckDB({ database_path: ":memory:" });
    await metadata_db.init();
    await create_metadata_schema(metadata_db);

    cache_db = new DuckDB({ database_path: ":memory:" });
    await cache_db.init();
    await create_content_cache_schema(cache_db);
    cache = new ContentCache(cache_db);
  });

  afterEach(async () => {
    await metadata_db.close();
    await cache_db.close();
  });

  it("forgets by URL: metadata rows, fetch log, and cache entry all go", async () => {
    await seed_visit("a", "https://example.com/a", "2026-06-01T10:00:00Z");
    await seed_visit("b", "https://example.com/b", "2026-06-01T11:00:00Z");

    const report = await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/a",
    });

    expect(report.page_session_ids).toBe(1);
    expect(report.content_cache_swept).toBe(true);
    expect(await get_webpage_capture(metadata_db, "a")).toBeNull();
    expect(await get_latest_webpage_fetch(metadata_db, "a")).toBeNull();
    expect(await cache.get("a")).toBeNull();
    // The unrelated visit survives in every store.
    expect(await get_webpage_capture(metadata_db, "b")).not.toBeNull();
    expect(await get_latest_webpage_fetch(metadata_db, "b")).not.toBeNull();
    expect(await cache.get("b")).not.toBeNull();
    expect(await session_count()).toBe(1);
  });

  it("forgets by origin: every page on the site, other origins untouched", async () => {
    await seed_visit("s1", "https://secret.example.com/one", "2026-06-01T10:00:00Z");
    await seed_visit("s2", "https://secret.example.com/two?q=x", "2026-06-01T11:00:00Z");
    await seed_visit("keep", "https://other.example.com/page", "2026-06-01T12:00:00Z");

    const report = await forget(metadata_db, cache, {
      kind: "origin",
      origin: "https://secret.example.com",
    });

    expect(report.page_session_ids).toBe(2);
    expect(await get_webpage_capture(metadata_db, "s1")).toBeNull();
    expect(await get_webpage_capture(metadata_db, "s2")).toBeNull();
    expect(await cache.get("s1")).toBeNull();
    expect(await cache.get("s2")).toBeNull();
    expect(await get_webpage_capture(metadata_db, "keep")).not.toBeNull();
    expect(await cache.get("keep")).not.toBeNull();
  });

  it("forgets by time range (inclusive), leaving visits outside the window", async () => {
    await seed_visit("before", "https://example.com/0", "2026-05-31T23:59:59Z");
    await seed_visit("in1", "https://example.com/1", "2026-06-01T00:00:00Z");
    await seed_visit("in2", "https://example.com/2", "2026-06-02T12:00:00Z");
    await seed_visit("after", "https://example.com/3", "2026-06-03T00:00:01Z");

    const report = await forget(metadata_db, cache, {
      kind: "time_range",
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-03T00:00:00Z",
    });

    expect(report.page_session_ids).toBe(2);
    expect(await get_webpage_capture(metadata_db, "in1")).toBeNull();
    expect(await get_webpage_capture(metadata_db, "in2")).toBeNull();
    expect(await get_webpage_capture(metadata_db, "before")).not.toBeNull();
    expect(await get_webpage_capture(metadata_db, "after")).not.toBeNull();
  });

  it("removes trees left empty and keeps trees with surviving sessions", async () => {
    await seed_visit("solo", "https://example.com/solo", "2026-06-01T10:00:00Z", "tree-solo");
    await seed_visit("x1", "https://example.com/x1", "2026-06-01T11:00:00Z", "tree-shared");
    await seed_visit("x2", "https://other.com/x2", "2026-06-01T11:05:00Z", "tree-shared");

    await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/solo",
    });
    expect(await tree_count()).toBe(1); // tree-solo removed, tree-shared kept

    await forget(metadata_db, cache, { kind: "url", url: "https://example.com/x1" });
    expect(await tree_count()).toBe(1); // tree-shared still has x2
  });

  it("scrubs surviving sessions' referrer fields that encode the forgotten page", async () => {
    await seed_visit("parent", "https://forgotten.com/parent", "2026-06-01T10:00:00Z", "tree-1");
    await seed_visit("child", "https://kept.com/child", "2026-06-01T10:01:00Z", "tree-1", {
      url: "https://forgotten.com/parent",
      id: "parent",
    });

    await forget(metadata_db, cache, {
      kind: "url",
      url: "https://forgotten.com/parent",
    });

    const child = await metadata_db.query_first<{
      referrer: unknown;
      referrer_page_session_id: unknown;
    }>(
      "SELECT referrer, referrer_page_session_id FROM webpage_activity_sessions WHERE id = 'child'"
    );
    expect(child?.referrer).toBeNull();
    expect(child?.referrer_page_session_id).toBeNull();
  });

  it("origin forget scrubs truncated cross-origin referrers (origin-only form)", async () => {
    await seed_visit("target", "https://secret.example.com/page", "2026-06-01T10:00:00Z");
    // Cross-origin referrer policy truncates the referrer to the bare origin.
    await seed_visit("other", "https://kept.com/page", "2026-06-01T10:05:00Z", "tree-other", {
      url: "https://secret.example.com/",
      id: "target",
    });

    await forget(metadata_db, cache, {
      kind: "origin",
      origin: "https://secret.example.com",
    });

    const other = await metadata_db.query_first<{ referrer: unknown }>(
      "SELECT referrer FROM webpage_activity_sessions WHERE id = 'other'"
    );
    expect(other?.referrer).toBeNull();
  });

  it("is idempotent: re-running the same forget is a harmless no-op", async () => {
    await seed_visit("a", "https://example.com/a", "2026-06-01T10:00:00Z");

    const first = await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/a",
    });
    const second = await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/a",
    });

    expect(first.page_session_ids).toBe(1);
    expect(second.page_session_ids).toBe(0);
  });

  it("runs without a content cache (none exists yet) and reports that", async () => {
    await seed_visit("a", "https://example.com/a", "2026-06-01T10:00:00Z");

    const report = await forget(metadata_db, null, {
      kind: "url",
      url: "https://example.com/a",
    });

    expect(report.page_session_ids).toBe(1);
    expect(report.content_cache_swept).toBe(false);
    expect(await get_webpage_capture(metadata_db, "a")).toBeNull();
  });

  it("rolls back metadata on mid-transaction failure; cache already swept; re-run completes", async () => {
    await seed_visit("a", "https://example.com/a", "2026-06-01T10:00:00Z");

    // Poison the LAST in-transaction statement (the referrer scrub UPDATE).
    metadata_db.poison = /UPDATE webpage_activity_sessions/;
    await expect(
      forget(metadata_db, cache, { kind: "url", url: "https://example.com/a" })
    ).rejects.toThrow(/poisoned/);

    // Cache swept first (the safe direction)...
    expect(await cache.get("a")).toBeNull();
    // ...metadata fully intact after ROLLBACK — fetch log, capture, session.
    expect(await get_webpage_capture(metadata_db, "a")).not.toBeNull();
    expect(await get_latest_webpage_fetch(metadata_db, "a")).not.toBeNull();
    expect(await session_count()).toBe(1);

    // Re-running the same forget from the partial state completes it.
    metadata_db.poison = null;
    const report = await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/a",
    });
    expect(report.page_session_ids).toBe(1);
    expect(await get_webpage_capture(metadata_db, "a")).toBeNull();
  });

  it("a failing cache sweep leaves metadata untouched (cache-first ordering)", async () => {
    await seed_visit("a", "https://example.com/a", "2026-06-01T10:00:00Z");

    await expect(
      forget(metadata_db, new PoisonedCache(cache_db), {
        kind: "url",
        url: "https://example.com/a",
      })
    ).rejects.toThrow("cache down");

    expect(await get_webpage_capture(metadata_db, "a")).not.toBeNull();
    expect(await session_count()).toBe(1);
  });

  it("re-running a forget completes a previously failed empty-tree sweep", async () => {
    await seed_visit("solo", "https://example.com/solo", "2026-06-01T10:00:00Z");

    metadata_db.poison = /DELETE FROM webpage_trees/;
    await expect(
      forget(metadata_db, cache, { kind: "url", url: "https://example.com/solo" })
    ).rejects.toThrow(/poisoned/);
    expect(await session_count()).toBe(0); // transaction committed
    expect(await tree_count()).toBe(1); // orphaned tree left behind

    metadata_db.poison = null;
    await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/solo",
    });
    expect(await tree_count()).toBe(0); // the always-run sweep completes it
  });

  it("deletes a fetch row whose final_url is the forgotten URL (redirect), keeping its session", async () => {
    await seed_visit("keep", "https://t.co/abc", "2026-06-01T09:00:00Z");
    await seed_visit("victim", "https://example.com/a", "2026-06-01T10:00:00Z");
    // keep's re-download redirected to the soon-forgotten URL.
    await insert_webpage_fetch(metadata_db, {
      page_session_id: "keep",
      url: "https://t.co/abc",
      final_url: "https://example.com/a",
      outcome: "ok",
      http_status: 200,
      content_hash: "h",
      content_type: "text/html",
      author: null,
      published_at: null,
      lang: null,
      site_name: null,
      fetched_at: "2026-06-01T09:00:01Z",
    });

    await forget(metadata_db, cache, { kind: "url", url: "https://example.com/a" });

    const orphan = await metadata_db.query_first<{ n: unknown }>(
      "SELECT count(*)::INTEGER AS n FROM webpage_fetch WHERE final_url = 'https://example.com/a'"
    );
    expect(Number(orphan?.n)).toBe(0); // redirect row gone
    // keep's own visit survives — only the connecting fetch row encoded the URL.
    expect(await get_webpage_capture(metadata_db, "keep")).not.toBeNull();
    expect(await session_count()).toBe(1);
  });

  it("a URL existing only as an orphan fetch row and cache row is still forgotten", async () => {
    // No capture/session rows at all — e.g. leftovers of an earlier partial run.
    await insert_webpage_fetch(metadata_db, {
      page_session_id: "ghost",
      url: "https://example.com/orphan",
      final_url: "https://example.com/orphan",
      outcome: "ok",
      http_status: 200,
      content_hash: "h",
      content_type: "text/html",
      author: null,
      published_at: null,
      lang: null,
      site_name: null,
      fetched_at: "2026-06-01T09:00:00Z",
    });
    await cache.put(cached("ghost", "https://example.com/orphan"), "scope");

    const report = await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/orphan",
    });

    expect(report.page_session_ids).toBe(0);
    const remaining = await metadata_db.query_first<{ n: unknown }>(
      "SELECT count(*)::INTEGER AS n FROM webpage_fetch"
    );
    expect(Number(remaining?.n)).toBe(0);
    expect(await cache.get("ghost")).toBeNull();
  });

  it("origin forget sweeps cache rows on the origin that no metadata row carries", async () => {
    await cache.put(
      cached("cache-only", "https://secret.example.com/cached-only"),
      "scope"
    );
    await seed_visit("other", "https://kept.com/x", "2026-06-01T10:00:00Z");

    await forget(metadata_db, cache, {
      kind: "origin",
      origin: "https://secret.example.com",
    });

    expect(await cache.get("cache-only")).toBeNull();
    expect(await cache.get("other")).not.toBeNull();
  });

  it("resolves capture-only and session-only rows, with millisecond timestamps (epoch compare)", async () => {
    // Capture row with no session, millisecond precision exactly on the bound.
    await insert_webpage_capture(metadata_db, {
      page_session_id: "cap-only",
      url: "https://example.com/cap",
      title: "Cap",
      content_type: "text/html",
      captured_at: "2026-06-01T00:00:00.000Z",
    });
    // Session row with no capture.
    await insert_webpage_tree(metadata_db, "tree-sess", "2026-06-01T12:00:00Z", "2026-06-01T12:00:00Z");
    await insert_page_activity_session(metadata_db, {
      id: "sess-only",
      url: "https://example.com/sess",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2026-06-01T12:00:00.500Z",
      tree_id: "tree-sess",
    });

    const report = await forget(metadata_db, cache, {
      kind: "time_range",
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-02T00:00:00Z",
    });

    expect(report.page_session_ids).toBe(2);
    expect(await get_webpage_capture(metadata_db, "cap-only")).toBeNull();
    expect(await session_count()).toBe(0);
  });

  it("accepts offset-bearing time bounds (epoch comparison, not string order)", async () => {
    await seed_visit("in", "https://example.com/in", "2026-06-01T11:30:00.000Z");

    const report = await forget(metadata_db, cache, {
      kind: "time_range",
      from: "2026-06-01T12:00:00+01:00", // = 11:00Z
      to: "2026-06-01T13:00:00+01:00", // = 12:00Z
    });

    expect(report.page_session_ids).toBe(1);
    expect(await get_webpage_capture(metadata_db, "in")).toBeNull();
  });

  it("counts distinct URLs in the report when several sessions share one URL", async () => {
    await seed_visit("v1", "https://example.com/shared", "2026-06-01T10:00:00Z");
    await seed_visit("v2", "https://example.com/shared", "2026-06-01T11:00:00Z");

    const report = await forget(metadata_db, cache, {
      kind: "url",
      url: "https://example.com/shared",
    });

    expect(report.page_session_ids).toBe(2);
    expect(report.urls).toBe(1);
  });

  it("origin matching is exact: ports and schemes are distinct, malformed URLs survive", async () => {
    await seed_visit("https-page", "https://example.com/a", "2026-06-01T10:00:00Z");
    await seed_visit("port-page", "https://example.com:8443/b", "2026-06-01T10:01:00Z");
    await seed_visit("http-page", "http://example.com/c", "2026-06-01T10:02:00Z");
    await seed_visit("broken", "not a url", "2026-06-01T10:03:00Z");

    const report = await forget(metadata_db, cache, {
      kind: "origin",
      origin: "https://example.com",
    });

    expect(report.page_session_ids).toBe(1);
    expect(await get_webpage_capture(metadata_db, "https-page")).toBeNull();
    expect(await get_webpage_capture(metadata_db, "port-page")).not.toBeNull();
    expect(await get_webpage_capture(metadata_db, "http-page")).not.toBeNull();
    expect(await get_webpage_capture(metadata_db, "broken")).not.toBeNull();
  });

  it("sweeps matching visit_inbox rows from the encrypted store (AC#3)", async () => {
    // Seed two inbox rows directly into the metadata store.
    await metadata_db.execute(
      `INSERT INTO visit_inbox (id, url, page_loaded_at, visit_json) VALUES
         ('inbox-match', 'https://example.com/a', '2026-06-01T10:00:00Z', '{"id":"inbox-match","url":"https://example.com/a"}'),
         ('inbox-keep',  'https://kept.com/x',    '2026-06-01T10:00:00Z', '{"id":"inbox-keep","url":"https://kept.com/x"}')`
    );

    await forget(metadata_db, cache, { kind: "url", url: "https://example.com/a" });

    const remaining = await metadata_db.query<{ id: string }>(
      `SELECT id FROM visit_inbox`
    );
    expect(remaining.map((r) => r.id)).toEqual(["inbox-keep"]);
  });

  it("sweeps matching replay files under the storage base and does not touch visit_inbox dir (AC#3)", async () => {
    const storage_base = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-sweep-"));
    fs.mkdirSync(path.join(storage_base, "captures"));
    const write_capture = (name: string, url: string, at: string) =>
      fs.writeFileSync(
        path.join(storage_base, "captures", name),
        JSON.stringify({ id: name, url, page_loaded_at: at, title: "t" })
      );
    write_capture("replay-match.json", "https://example.com/a", "2026-06-01T10:00:00Z");
    write_capture("replay-keep.json", "https://kept.com/x", "2026-06-01T10:00:00Z");

    const report = await forget(
      metadata_db,
      cache,
      { kind: "url", url: "https://example.com/a" },
      { storage_base }
    );

    expect(report.files_removed).toBe(1);
    expect(fs.existsSync(path.join(storage_base, "captures", "replay-match.json"))).toBe(false);
    expect(fs.existsSync(path.join(storage_base, "captures", "replay-keep.json"))).toBe(true);
    // No visit_inbox directory is created — the inbox is now in the DB.
    expect(fs.existsSync(path.join(storage_base, "visit_inbox"))).toBe(false);

    fs.rmSync(storage_base, { recursive: true, force: true });
  });

  it("sweeps cache rows for the forgotten URL even under a different session id", async () => {
    await seed_visit("a", "https://example.com/a", "2026-06-01T10:00:00Z");
    // An older cache row for the same URL under a stale session id.
    await cache.put(cached("a-old", "https://example.com/a"), "old-scope");

    await forget(metadata_db, cache, { kind: "url", url: "https://example.com/a" });

    expect(await cache.get("a-old")).toBeNull();
  });
});

describe("right-to-forget cascade (real encrypted files)", () => {
  it("forgotten content is durably gone from both stores after reopen", async () => {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-forget-"));
    const metadata_path = path.join(temp_dir, "webpage_categorizations.db");
    const cache_path = path.join(temp_dir, "content_cache.db");

    const open_both = async () => {
      const metadata_db = new DuckDB({
        database_path: metadata_path,
        encryption_key: TEST_KEY,
      });
      await metadata_db.init();
      await create_metadata_schema(metadata_db);
      const cache_db = new DuckDB({
        database_path: cache_path,
        encryption_key: TEST_KEY,
      });
      await cache_db.init();
      await create_content_cache_schema(cache_db);
      return { metadata_db, cache_db, cache: new ContentCache(cache_db) };
    };

    const first = await open_both();
    await insert_webpage_capture(first.metadata_db, {
      page_session_id: "f1",
      url: "https://example.com/forget",
      title: "Forget Me",
      content_type: "text/html",
      captured_at: "2026-06-01T10:00:00Z",
    });
    await first.cache.put(cached("f1", "https://example.com/forget"), "scope");

    await forget(first.metadata_db, first.cache, {
      kind: "url",
      url: "https://example.com/forget",
    });
    await first.metadata_db.close();
    await first.cache_db.close();

    const second = await open_both();
    expect(await get_webpage_capture(second.metadata_db, "f1")).toBeNull();
    expect(await second.cache.get("f1")).toBeNull();
    await second.metadata_db.close();
    await second.cache_db.close();

    fs.rmSync(temp_dir, { recursive: true, force: true });
  });
});
