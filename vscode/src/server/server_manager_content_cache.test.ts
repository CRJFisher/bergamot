import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import request from "supertest";
import { Application } from "express";
import { ServerManager } from "./server_manager";
import {
  DuckDB,
  create_metadata_schema,
  insert_webpage_capture,
} from "../duck_db";
import { CONTENT_CACHE_DB_FILENAME } from "../redownload/content_cache";
import { Fetcher, FetchResult } from "../redownload/headless_fetcher";

/**
 * Verifies the default content read path persists re-downloads into the
 * encrypted content cache (task-39.10): with SecretStorage present the server
 * wraps the live corpus in a CachedCorpus under the `"default"` scope, so a
 * second read of an ok page is served from the cache with no re-fetch and
 * exclusions are never cached; it closes the cache (releasing the DuckDB file
 * lock) at stop; and it bypasses caching entirely when a corpus is injected or
 * no SecretStorage is configured. An injected fetcher drives the path without a
 * browser.
 */
function fake_secrets(): vscode.SecretStorage {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    onDidChange: () => ({ dispose: () => undefined }),
  };
}

const OK_URL = "https://example.com/p1";
const AUTH_URL = "https://example.com/members";

const OK_HTML = `<!doctype html><html lang="en"><head>
    <title>Public</title><meta property="og:title" content="Public"></head>
  <body><main><article><h1>Public</h1>
  <p>clean extracted body text with enough words to extract cleanly.</p>
  </article></main></body></html>`;

const OK_RESULT: FetchResult = {
  outcome: { kind: "ok", html: OK_HTML, final_url: OK_URL, http_status: 200 },
  fidelity: {
    fetched_at: "2026-06-09T00:00:00.000Z",
    http_status: 200,
    content_hash: "a".repeat(64),
    final_url: OK_URL,
    redirect_count: 0,
  },
  retry_after_ms: null,
};

const AUTH_RESULT: FetchResult = {
  outcome: {
    kind: "auth_redirect",
    final_url: "https://example.com/login",
    http_status: null,
    reason: "redirected to login url",
  },
  fidelity: {
    fetched_at: "2026-06-09T00:01:00.000Z",
    http_status: 302,
    content_hash: null,
    final_url: "https://example.com/login",
    redirect_count: 1,
  },
  retry_after_ms: null,
};

/** A fetcher that serves canned results and counts how often it is hit. */
class CountingFetcher implements Fetcher {
  fetch_count = 0;
  constructor(private readonly by_url: Map<string, FetchResult>) {}
  async fetch(url: string): Promise<FetchResult> {
    this.fetch_count++;
    const result = this.by_url.get(url);
    if (!result) throw new Error(`no canned result for ${url}`);
    return result;
  }
}

describe("ServerManager default-path content cache", () => {
  let temp_dir: string;
  let db: DuckDB;

  beforeEach(async () => {
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-server-cache-"));
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    await insert_webpage_capture(db, {
      page_session_id: "p1",
      url: OK_URL,
      title: "seed",
      content_type: "text/html",
      captured_at: "2026-06-08T00:00:00.000Z",
    });
    await insert_webpage_capture(db, {
      page_session_id: "auth1",
      url: AUTH_URL,
      title: "seed",
      content_type: "text/html",
      captured_at: "2026-06-08T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  it("caches an ok read and serves the second read from cache without re-fetching", async () => {
    const fetcher = new CountingFetcher(
      new Map([
        [OK_URL, OK_RESULT],
        [AUTH_URL, AUTH_RESULT],
      ])
    );
    const manager = new ServerManager({
      duck_db: db,
      storage_base: temp_dir,
      secrets: fake_secrets(),
      fetcher,
    });
    // prepare() (not start()) enables caching + mounts routes without binding a
    // port, so the test drives the same cached read path the server serves.
    await manager.prepare();
    const app = (manager as object as { app: Application }).app;
    try {
      const first = await request(app)
        .get("/query/capture_content")
        .query({ page_session_id: "p1" })
        .expect(200);
      expect(first.body.outcome).toBe("ok");
      expect(first.body.content.content).toContain("clean extracted body");
      expect(fetcher.fetch_count).toBe(1);

      // Second read is a cache hit: no second fetch, same extracted markdown.
      const second = await request(app)
        .get("/query/capture_content")
        .query({ page_session_id: "p1" })
        .expect(200);
      expect(second.body.content.content).toBe(first.body.content.content);
      expect(fetcher.fetch_count).toBe(1);

      // The server-owned cache holds the page; exclusions are never cached.
      expect((await manager.get_content_cache()!.get("p1"))?.content).toContain(
        "clean extracted body"
      );

      const excluded = await request(app)
        .get("/query/capture_content")
        .query({ page_session_id: "auth1" })
        .expect(200);
      expect(excluded.body.outcome).toBe("auth_redirect");
      expect(await manager.get_content_cache()!.get("auth1")).toBeNull();
    } finally {
      await manager.stop();
    }
    // The handle is released on stop.
    expect(manager.get_content_cache()).toBeNull();
    expect(fs.existsSync(path.join(temp_dir, CONTENT_CACHE_DB_FILENAME))).toBe(
      true
    );
  });

  it("bypasses the cache when a corpus is injected, even with SecretStorage", async () => {
    const manager = new ServerManager({
      duck_db: db,
      storage_base: temp_dir,
      secrets: fake_secrets(),
      content_corpus: {
        async get_content() {
          return null;
        },
        async *iter_public_pages() {
          // no pages
        },
      },
    });
    await manager.prepare();
    expect(manager.get_content_cache()).toBeNull();
    await manager.stop();
  });

  it("stays uncached when no SecretStorage is configured", async () => {
    const manager = new ServerManager({
      duck_db: db,
      storage_base: temp_dir,
      fetcher: new CountingFetcher(new Map([[OK_URL, OK_RESULT]])),
    });
    await manager.prepare();
    expect(manager.get_content_cache()).toBeNull();
    expect(fs.existsSync(path.join(temp_dir, CONTENT_CACHE_DB_FILENAME))).toBe(
      false
    );
    await manager.stop();
  });
});
