import {
  DuckDB,
  create_metadata_schema,
  insert_webpage_capture,
} from "../duck_db";
import { ContentCorpus, CorpusContent, CorpusEntry } from "./corpus";
import { ContentCache, create_content_cache_schema } from "./content_cache";
import { CachedCorpus } from "./cached_corpus";

function corpus_content(page_session_id: string, content: string): CorpusContent {
  return {
    page_session_id,
    url: `https://example.com/${page_session_id}`,
    title: `Title ${page_session_id}`,
    content,
    site_name: null,
    author: null,
    published_at: null,
    lang: null,
    fetched_at: "2026-06-09T12:00:00Z",
    http_status: 200,
    content_hash: `hash-${page_session_id}`,
  };
}

/** A corpus fake that counts live reads and serves canned entries. */
class FakeCorpus implements ContentCorpus {
  public live_reads: string[] = [];
  constructor(private readonly entries: Map<string, CorpusEntry>) {}

  async get_content(page_session_id: string): Promise<CorpusEntry | null> {
    this.live_reads.push(page_session_id);
    return this.entries.get(page_session_id) ?? null;
  }

  async *iter_public_pages(): AsyncIterable<CorpusContent> {
    for (const entry of this.entries.values()) {
      if (entry.outcome === "ok") yield entry.content;
    }
  }
}

describe("CachedCorpus", () => {
  let metadata_db: DuckDB;
  let cache_db: DuckDB;
  let cache: ContentCache;

  beforeEach(async () => {
    metadata_db = new DuckDB({ database_path: ":memory:" });
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

  async function seed_capture(page_session_id: string): Promise<void> {
    await insert_webpage_capture(metadata_db, {
      page_session_id,
      url: `https://example.com/${page_session_id}`,
      title: `Title ${page_session_id}`,
      content_type: "text/html",
      captured_at: "2026-06-09T11:00:00Z",
    });
  }

  it("serves the second read from the cache without a live fetch", async () => {
    await seed_capture("p1");
    const fake = new FakeCorpus(
      new Map([
        ["p1", { outcome: "ok", content: corpus_content("p1", "<html>x</html>") }],
      ])
    );
    const corpus = new CachedCorpus(metadata_db, fake, cache, "tdt-run-1");

    const first = await corpus.get_content("p1");
    const second = await corpus.get_content("p1");

    expect(first?.outcome).toBe("ok");
    expect(second?.outcome).toBe("ok");
    if (second?.outcome === "ok") {
      expect(second.content.content).toBe("<html>x</html>");
    }
    expect(fake.live_reads).toEqual(["p1"]);
  });

  it("does not cache exclusions — they re-classify on every read", async () => {
    await seed_capture("walled");
    const fake = new FakeCorpus(
      new Map([
        [
          "walled",
          {
            outcome: "auth_redirect",
            page_session_id: "walled",
            url: "https://example.com/walled",
            reason: "redirected to login",
          },
        ],
      ])
    );
    const corpus = new CachedCorpus(metadata_db, fake, cache, "scope");

    const first = await corpus.get_content("walled");
    const second = await corpus.get_content("walled");

    expect(first?.outcome).toBe("auth_redirect");
    expect(second?.outcome).toBe("auth_redirect");
    // Both reads go live: an exclusion is never cached, so it cannot serve a hit.
    expect(fake.live_reads).toEqual(["walled", "walled"]);
    expect(await cache.get("walled")).toBeNull();
  });

  it("returns null (and caches nothing) for an unknown page id", async () => {
    const fake = new FakeCorpus(new Map());
    const corpus = new CachedCorpus(metadata_db, fake, cache, "scope");

    expect(await corpus.get_content("missing")).toBeNull();
    expect(await cache.get("missing")).toBeNull();
  });

  it("iterates the public subset through the cache (second pass fetch-free)", async () => {
    await seed_capture("pub");
    await seed_capture("walled");
    const fake = new FakeCorpus(
      new Map<string, CorpusEntry>([
        ["pub", { outcome: "ok", content: corpus_content("pub", "<html>pub</html>") }],
        [
          "walled",
          {
            outcome: "auth_redirect",
            page_session_id: "walled",
            url: "https://example.com/walled",
            reason: "redirected to login",
          },
        ],
      ])
    );
    const corpus = new CachedCorpus(metadata_db, fake, cache, "tdt-run-1");

    const first_pass: string[] = [];
    for await (const page of corpus.iter_public_pages()) {
      first_pass.push(page.page_session_id);
    }
    expect(first_pass).toEqual(["pub"]);

    fake.live_reads = [];
    const second_pass: string[] = [];
    for await (const page of corpus.iter_public_pages()) {
      second_pass.push(page.page_session_id);
    }
    expect(second_pass).toEqual(["pub"]);
    // The public page is served from the cache; only the exclusion re-classifies.
    expect(fake.live_reads).toEqual(["walled"]);
  });

  it("returns null and purges the stale cache row when the metadata row is gone", async () => {
    // A page whose metadata was forgotten must not stay servable from the
    // cache, even though its content was cached earlier.
    await seed_capture("p1");
    const fake = new FakeCorpus(
      new Map([
        ["p1", { outcome: "ok", content: corpus_content("p1", "<html>x</html>") }],
      ])
    );
    const corpus = new CachedCorpus(metadata_db, fake, cache, "scope");
    await corpus.get_content("p1");
    expect(await cache.get("p1")).not.toBeNull();

    await metadata_db.execute(
      "DELETE FROM webpage_capture WHERE page_session_id = $id",
      { id: "p1" }
    );

    expect(await corpus.get_content("p1")).toBeNull();
    expect(await cache.get("p1")).toBeNull();
  });

  it("returns null without throwing when stale-row eviction fails", async () => {
    // A cache failure while purging a forgotten page must not surface as an
    // error to the caller — eviction is the cascade's best-effort backstop.
    const fake = new FakeCorpus(new Map());
    cache.get = async () => {
      throw new Error("simulated cache read failure during eviction");
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const corpus = new CachedCorpus(metadata_db, fake, cache, "scope");

    expect(await corpus.get_content("forgotten")).toBeNull();
    warn.mockRestore();
    // No metadata row exists, so the live corpus is never consulted.
    expect(fake.live_reads).toEqual([]);
  });

  it("does not cache an ok page whose metadata was forgotten during the live fetch", async () => {
    // A forget can complete while the seconds-long live fetch is in flight.
    // Writing the page back afterwards would re-encode forgotten content, so the
    // metadata row is re-checked before the cache write.
    await seed_capture("p1");
    const fake = new FakeCorpus(
      new Map([
        ["p1", { outcome: "ok", content: corpus_content("p1", "<html>x</html>") }],
      ])
    );
    const inner = fake.get_content.bind(fake);
    fake.get_content = async (id: string) => {
      // The forget cascade deletes the metadata row mid-fetch.
      await metadata_db.execute(
        "DELETE FROM webpage_capture WHERE page_session_id = $id",
        { id }
      );
      return inner(id);
    };
    const corpus = new CachedCorpus(metadata_db, fake, cache, "default");

    const entry = await corpus.get_content("p1");
    // The live result is still returned to the caller...
    expect(entry?.outcome).toBe("ok");
    // ...but it is not written back to the cache — forgotten content stays gone.
    expect(await cache.get("p1")).toBeNull();
  });

  it("degrades to the live result when a cache write fails", async () => {
    await seed_capture("p1");
    const fake = new FakeCorpus(
      new Map([
        ["p1", { outcome: "ok", content: corpus_content("p1", "<html>live</html>") }],
      ])
    );
    cache.put = async () => {
      throw new Error("simulated cache write failure");
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const corpus = new CachedCorpus(metadata_db, fake, cache, "default");

    const entry = await corpus.get_content("p1");
    warn.mockRestore();
    // A cache write failure must not deny a page the live corpus served.
    expect(entry?.outcome).toBe("ok");
    if (entry?.outcome === "ok") {
      expect(entry.content.content).toBe("<html>live</html>");
    }
  });

  it("degrades to a live fetch when a cache read fails", async () => {
    await seed_capture("p1");
    await cache.put(corpus_content("p1", "<html>cached</html>"), "default");
    cache.get = async () => {
      throw new Error("simulated cache read failure");
    };
    const fake = new FakeCorpus(
      new Map([
        ["p1", { outcome: "ok", content: corpus_content("p1", "<html>live</html>") }],
      ])
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const corpus = new CachedCorpus(metadata_db, fake, cache, "default");

    const entry = await corpus.get_content("p1");
    warn.mockRestore();
    // A corrupt/unreadable cache must fall through to a live re-download.
    expect(entry?.outcome).toBe("ok");
    if (entry?.outcome === "ok") {
      expect(entry.content.content).toBe("<html>live</html>");
    }
    expect(fake.live_reads).toEqual(["p1"]);
  });

  it("attributes cached rows to the wrapper's scope (delete_scope empties the pass)", async () => {
    await seed_capture("p1");
    const fake = new FakeCorpus(
      new Map([
        ["p1", { outcome: "ok", content: corpus_content("p1", "<html>x</html>") }],
      ])
    );
    const corpus = new CachedCorpus(metadata_db, fake, cache, "tdt-run-1");
    await corpus.get_content("p1");

    await cache.delete_scope("some-other-scope");
    expect(await cache.get("p1")).not.toBeNull();

    await cache.delete_scope("tdt-run-1");
    expect(await cache.get("p1")).toBeNull();

    // With the cache row evicted, the next read falls through to a live fetch.
    fake.live_reads = [];
    await corpus.get_content("p1");
    expect(fake.live_reads).toEqual(["p1"]);
  });

  it("isolates a per-page failure: one throwing page does not abort the pass", async () => {
    await seed_capture("bad");
    await seed_capture("good");
    const fake = new FakeCorpus(
      new Map([
        ["good", { outcome: "ok", content: corpus_content("good", "<html>g</html>") }],
      ])
    );
    const throwing_get = fake.get_content.bind(fake);
    fake.get_content = async (id: string) => {
      if (id === "bad") throw new Error("transient browser failure");
      return throwing_get(id);
    };
    const corpus = new CachedCorpus(metadata_db, fake, cache, "scope");

    const yielded: string[] = [];
    for await (const page of corpus.iter_public_pages()) {
      yielded.push(page.page_session_id);
    }
    expect(yielded).toEqual(["good"]);
  });
});
