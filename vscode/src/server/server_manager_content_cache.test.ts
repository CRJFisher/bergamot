import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ServerManager } from "./server_manager";
import {
  DuckDB,
  create_metadata_schema,
  insert_webpage_capture,
} from "../duck_db";
import { CONTENT_CACHE_DB_FILENAME } from "../redownload/content_cache";
import {
  ContentCorpus,
  CorpusContent,
  CorpusEntry,
} from "../redownload/corpus";

/**
 * Verifies the default content read path persists re-downloads into the
 * encrypted content cache (task-39.10): the server opens the cache at start
 * under the `"default"` scope when SecretStorage is present, closes it (and
 * releases the DuckDB file lock) at stop, and bypasses caching entirely when a
 * corpus is injected or no SecretStorage is configured.
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

const PUBLIC: CorpusContent = {
  page_session_id: "p1",
  url: "https://example.com/p1",
  title: "Public",
  content: "# Public\n\nclean extracted body",
  site_name: "Example",
  author: null,
  published_at: null,
  lang: "en",
  fetched_at: "2026-06-09T12:00:00Z",
  http_status: 200,
  content_hash: "h".repeat(64),
};

/** A corpus that serves one ok page without any network or browser. */
const fake_corpus: ContentCorpus = {
  async get_content(id: string): Promise<CorpusEntry | null> {
    return id === "p1" ? { outcome: "ok", content: PUBLIC } : null;
  },
  async *iter_public_pages() {
    yield PUBLIC;
  },
};

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
      url: "https://example.com/p1",
      title: "seed",
      content_type: "text/html",
      captured_at: "2026-06-08T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  it("bypasses the cache when a corpus is injected, even with SecretStorage", async () => {
    const manager = new ServerManager({
      duck_db: db,
      storage_base: temp_dir,
      secrets: fake_secrets(),
      content_corpus: fake_corpus,
    });
    // Injection wins over the default-path cache wiring, so no cache is opened.
    await manager.start();
    expect(manager.get_content_cache()).toBeNull();
    await manager.stop();
  });

  it("opens the cache at start, serves through it, and releases it at stop", async () => {
    // No injected corpus: the server builds the live corpus and wraps it in the
    // caching corpus. Exercising the public read path end-to-end needs a browser,
    // so assert the cache is opened under the server's ownership and round-trips.
    const manager = new ServerManager({
      duck_db: db,
      storage_base: temp_dir,
      secrets: fake_secrets(),
    });
    await manager.start();
    const cache = manager.get_content_cache();
    expect(cache).not.toBeNull();
    expect(
      fs.existsSync(path.join(temp_dir, CONTENT_CACHE_DB_FILENAME))
    ).toBe(true);

    // The server-owned handle serves the cache; a put round-trips through brotli.
    await cache!.put(PUBLIC, "default");
    expect((await cache!.get("p1"))?.content).toBe(PUBLIC.content);

    await manager.stop();
    // The handle is released on stop, so get_content_cache reports none.
    expect(manager.get_content_cache()).toBeNull();
  });

  it("stays uncached when no SecretStorage is configured", async () => {
    const manager = new ServerManager({
      duck_db: db,
      storage_base: temp_dir,
    });
    await manager.start();
    expect(manager.get_content_cache()).toBeNull();
    expect(
      fs.existsSync(path.join(temp_dir, CONTENT_CACHE_DB_FILENAME))
    ).toBe(false);
    await manager.stop();
  });
});
