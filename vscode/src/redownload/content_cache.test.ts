import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import * as vscode from "vscode";
import { DuckDBBlobValue } from "@duckdb/node-api";
import { DuckDB } from "../duck_db";
import { CONTENT_CACHE_KEY_SECRET } from "../database/encryption_key";
import { CorpusContent } from "./corpus";
import {
  CONTENT_CACHE_DB_FILENAME,
  ContentCache,
  create_content_cache_schema,
  open_content_cache,
} from "./content_cache";

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

  it("stores the body brotli-compressed as a BLOB and round-trips it", async () => {
    const markdown = "# Heading\n\n" + "lorem ipsum dolor sit amet ".repeat(5_000);
    await cache.put(corpus_content("zip", markdown), "scope");

    // Round-trips back to the identical markdown string.
    expect((await cache.get("zip"))?.content).toBe(markdown);

    // Stored as a BLOB, materially smaller than the raw UTF-8 body, and the
    // bytes are real brotli (not driver-mangled text).
    const row = await db.query_first<{ content: unknown; n: number }>(
      `SELECT content, octet_length(content)::INTEGER AS n
       FROM cached_content WHERE page_session_id = $id`,
      { id: "zip" }
    );
    expect(row?.content).toBeInstanceOf(DuckDBBlobValue);
    expect(Number(row?.n)).toBeLessThan(Buffer.byteLength(markdown, "utf8") / 2);
    if (row?.content instanceof DuckDBBlobValue) {
      expect(zlib.brotliDecompressSync(row.content.bytes).toString("utf8")).toBe(
        markdown
      );
    }
  });

  it("round-trips multi-byte UTF-8 content through brotli", async () => {
    const md = "# Café\n\n— ünïcode ✓ — 日本語テキスト — emoji 🌿";
    await cache.put(corpus_content("utf8", md), "scope");
    expect((await cache.get("utf8"))?.content).toBe(md);
  });

  it("replaces the entry on re-cache (fresher fetch wins, newest writer owns the scope)", async () => {
    await cache.put(corpus_content("p1", "<html>old</html>"), "scope-a");
    await cache.put(corpus_content("p1", "<html>new</html>"), "scope-b");

    expect((await cache.get("p1"))?.content).toBe("<html>new</html>");
    // The row now belongs to scope-b: deleting scope-a leaves it, scope-b removes it.
    await cache.delete_scope("scope-a");
    expect(await cache.get("p1")).not.toBeNull();
    await cache.delete_scope("scope-b");
    expect(await cache.get("p1")).toBeNull();
  });

  it("delete_item on an uncached id is a no-op", async () => {
    await cache.put(corpus_content("p1", "<html>keep</html>"), "scope");

    await expect(cache.delete_item("never-cached")).resolves.toBeUndefined();
    expect(await cache.get("p1")).not.toBeNull();
  });

  it("delete_by_url removes every cached copy of that URL", async () => {
    await cache.put(
      corpus_content("p1", "<html>a</html>", "https://example.com/same"),
      "scope"
    );
    await cache.put(corpus_content("p2", "<html>b</html>"), "scope");

    await cache.delete_by_url("https://example.com/same");

    expect(await cache.get("p1")).toBeNull();
    expect(await cache.get("p2")).not.toBeNull();
  });

  it("delete_by_origin removes every cached row sharing an origin and spares others", async () => {
    await cache.put(
      corpus_content("a", "<html>a</html>", "https://example.com/one"),
      "scope"
    );
    await cache.put(
      corpus_content("b", "<html>b</html>", "https://example.com/two?q=1"),
      "scope"
    );
    await cache.put(
      corpus_content("c", "<html>c</html>", "https://other.example/page"),
      "scope"
    );

    await cache.delete_by_origin("https://example.com");

    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("c")).not.toBeNull();
  });

  it("delete_by_origin distinguishes port and scheme when matching origin", async () => {
    await cache.put(
      corpus_content("plain", "<html>p</html>", "https://example.com/x"),
      "scope"
    );
    await cache.put(
      corpus_content("ported", "<html>q</html>", "https://example.com:8443/x"),
      "scope"
    );

    await cache.delete_by_origin("https://example.com:8443");

    expect(await cache.get("plain")).not.toBeNull();
    expect(await cache.get("ported")).toBeNull();
  });

  it("delete_by_origin matching no row leaves the cache untouched", async () => {
    await cache.put(corpus_content("p1", "<html>keep</html>"), "scope");

    await cache.delete_by_origin("https://nowhere.example");

    expect(await cache.get("p1")).not.toBeNull();
  });

  it("delete_items with an empty list is a no-op", async () => {
    await cache.put(corpus_content("p1", "<html>keep</html>"), "scope");

    await expect(cache.delete_items([])).resolves.toBeUndefined();
    expect(await cache.get("p1")).not.toBeNull();
  });

  it("delete_items removes the whole set in one batch", async () => {
    await cache.put(corpus_content("p1", "<html>one</html>"), "scope");
    await cache.put(corpus_content("p2", "<html>two</html>"), "scope");
    await cache.put(corpus_content("p3", "<html>three</html>"), "scope");

    await cache.delete_items(["p1", "p3"]);

    expect(await cache.get("p1")).toBeNull();
    expect(await cache.get("p2")).not.toBeNull();
    expect(await cache.get("p3")).toBeNull();
  });

  it("preserves nullable metadata fields through a round-trip", async () => {
    const content = corpus_content("meta", "<html>m</html>");
    content.author = "Ada Lovelace";
    content.published_at = "2026-01-01T00:00:00Z";
    await cache.put(content, "scope");

    const hit = await cache.get("meta");
    expect(hit?.author).toBe("Ada Lovelace");
    expect(hit?.published_at).toBe("2026-01-01T00:00:00Z");
    expect(hit?.site_name).toBe("Example");
    expect(hit?.lang).toBe("en");
  });

  it("returns null metadata fields as null, not the string \"null\"", async () => {
    await cache.put(corpus_content("nulls", "<html>n</html>"), "scope");

    const hit = await cache.get("nulls");
    expect(hit?.author).toBeNull();
    expect(hit?.published_at).toBeNull();
  });

  it("round-trips quoted and large content (1MB+) through bound parameters", async () => {
    const big = `<html>${"x".repeat(1_200_000)}it's "quoted" content</html>`;
    await cache.put(corpus_content("big", big), "scope");

    expect((await cache.get("big"))?.content).toBe(big);
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
      // The body is brotli-compressed before storage, so a byte scan never sees
      // its plaintext; the title is stored as TEXT, so encryption is the only
      // thing hiding "Title of canary" — that absence is the load-bearing check.
      corpus_content("canary", `<html><body>${marker}</body></html>`),
      "canary-scope"
    );

    // Fresh rows live in the WAL until checkpoint — it must be as opaque as
    // the file (put() does not checkpoint; delete does). The WAL must exist
    // here, else this scan is vacuous.
    const wal_path = `${db_path}.wal`;
    expect(fs.existsSync(wal_path)).toBe(true);
    const wal_bytes = fs.readFileSync(wal_path);
    expect(wal_bytes.includes(marker)).toBe(false);
    // The title is plaintext TEXT (compression does not hide it), so its absence
    // in the WAL is the load-bearing proof that WAL encryption covers TEXT columns.
    expect(wal_bytes.includes("Title of canary")).toBe(false);

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

  it("a deleted item is durably gone after reopen", async () => {
    // Byte-scanning the encrypted file cannot distinguish deleted from
    // present; honest deletion verification is reopen + miss + row count.
    const first = await open_cache(TEST_KEY);
    await first.cache.put(corpus_content("forget-me", "<html>x</html>"), "scope");
    await first.cache.delete_item("forget-me");
    // The delete checkpointed the WAL away.
    expect(fs.existsSync(`${db_path}.wal`)).toBe(false);
    await first.db.close();

    const second = await open_cache(TEST_KEY);
    expect(await second.cache.get("forget-me")).toBeNull();
    const row = await second.db.query_first<{ n: number }>(
      "SELECT count(*)::INTEGER AS n FROM cached_content"
    );
    expect(Number(row?.n)).toBe(0);
    await second.db.close();
  });

  it("control: an unencrypted cache-shaped row DOES expose its title to a byte scan", async () => {
    // Proves the canary scan can see a plaintext leak in this table's real
    // shape — a TEXT `title` beside a compressed-BLOB `content`. The body is
    // opaque to a byte scan even unencrypted (brotli), so the title is the
    // plaintext field encryption must hide; this shows the scan detects it when
    // encryption is absent, so the canary's title assertion cannot pass
    // vacuously. The wrapper has no plaintext path, so this uses the raw driver.
    const { DuckDBInstance, blobValue } = jest.requireActual("@duckdb/node-api");
    const plain_path = path.join(temp_dir, "control-plain.db");
    const marker = "CACHE_PLAINTEXT_CANARY_TITLE";
    const body = zlib.brotliCompressSync(Buffer.from("# compressed body\n", "utf8"));

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(`ATTACH '${plain_path}' AS control`);
    await connection.run("USE control");
    await connection.run(
      `CREATE TABLE cached_content (
         page_session_id TEXT PRIMARY KEY, url TEXT NOT NULL,
         scope TEXT NOT NULL, title TEXT NOT NULL, content BLOB NOT NULL,
         author TEXT, site_name TEXT, published_at TEXT, lang TEXT,
         fetched_at TEXT NOT NULL, http_status INTEGER NOT NULL,
         content_hash TEXT NOT NULL, cached_at TEXT NOT NULL)`
    );
    await connection.run(
      `INSERT INTO cached_content VALUES (
         'canary', 'https://example.com/c', 'scope', $title, $content,
         NULL, NULL, NULL, NULL, '2026-06-09T12:00:00Z', 200, 'hash', '2026-06-09T12:00:00Z')`,
      { title: marker, content: blobValue(body) }
    );
    await connection.run("CHECKPOINT");
    connection.disconnectSync();
    instance.closeSync();

    const bytes = fs.readFileSync(plain_path);
    expect(bytes.includes(marker)).toBe(true);
  });

  it("open_content_cache derives path, key, and schema from the storage base", async () => {
    const secret_store = new Map<string, string>();
    const secrets: vscode.SecretStorage = {
      get: async (key: string) => secret_store.get(key),
      store: async (key: string, value: string) => {
        secret_store.set(key, value);
      },
      delete: async (key: string) => {
        secret_store.delete(key);
      },
      onDidChange: () => ({ dispose: () => undefined }),
    };

    const first = await open_content_cache(secrets, temp_dir);
    await first.put(corpus_content("p1", "<html>factory</html>"), "scope");
    await first.close();

    expect(fs.existsSync(path.join(temp_dir, CONTENT_CACHE_DB_FILENAME))).toBe(true);
    expect(secret_store.get(CONTENT_CACHE_KEY_SECRET)).toMatch(/^[0-9a-f]{64}$/);

    // Reopen reuses the persisted key and sees the data.
    const second = await open_content_cache(secrets, temp_dir);
    expect((await second.get("p1"))?.content).toBe("<html>factory</html>");
    await second.close();

    // Existing store + vanished key must throw, not re-key (39.4 guard).
    secret_store.delete(CONTENT_CACHE_KEY_SECRET);
    await expect(open_content_cache(secrets, temp_dir)).rejects.toThrow(
      /key is missing/
    );
  });
});
