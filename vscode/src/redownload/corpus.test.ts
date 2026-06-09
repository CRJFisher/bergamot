import { DuckDB, get_latest_webpage_fetch } from "../duck_db";
import { store_capture } from "../workflow/store_capture";
import { ReDownloadCorpus } from "./corpus";
import { Fetcher, FetchResult } from "./headless_fetcher";

/**
 * Verifies the corpus read path and its fidelity persistence without a browser:
 * a fake {@link Fetcher} returns canned outcomes over a real in-memory DuckDB, so
 * the get_content branching, the webpage_fetch logging (AC#3/#4), and the
 * public-subset iteration (AC#7) are all exercised deterministically.
 */
class FakeFetcher implements Fetcher {
  constructor(private readonly by_url: Map<string, FetchResult>) {}
  async fetch(url: string): Promise<FetchResult> {
    const result = this.by_url.get(url);
    if (!result) throw new Error(`no canned result for ${url}`);
    return result;
  }
}

const OK_URL = "https://example.com/public";
const AUTH_URL = "https://example.com/members";

const OK_RESULT: FetchResult = {
  outcome: {
    kind: "ok",
    html: "<html lang='en'><head><title>Public</title></head><body>hi</body></html>",
    final_url: OK_URL,
    http_status: 200,
  },
  fidelity: {
    fetched_at: "2026-06-09T00:00:00.000Z",
    http_status: 200,
    content_hash: "a".repeat(64),
    final_url: OK_URL,
    redirect_count: 0,
  },
  metadata: {
    title: "Public Title",
    site_name: "Example",
    author: "Ada Lovelace",
    published_at: "2026-01-01T00:00:00Z",
    lang: "en",
  },
  retry_after_ms: null,
};

const AUTH_RESULT: FetchResult = {
  outcome: {
    kind: "auth_redirect",
    final_url: "https://example.com/login",
    http_status: null,
    reason: "redirected to login url https://example.com/login",
  },
  fidelity: {
    fetched_at: "2026-06-09T00:01:00.000Z",
    http_status: 302,
    content_hash: null,
    final_url: "https://example.com/login",
    redirect_count: 1,
  },
  metadata: null,
  retry_after_ms: null,
};

describe("ReDownloadCorpus", () => {
  let db: DuckDB;
  let corpus: ReDownloadCorpus;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    // Seed two metadata rows whose URLs the fake fetcher knows.
    await seed_capture(db, "ok1", OK_URL);
    await seed_capture(db, "auth1", AUTH_URL);
    const fetcher = new FakeFetcher(
      new Map([
        [OK_URL, OK_RESULT],
        [AUTH_URL, AUTH_RESULT],
      ])
    );
    corpus = new ReDownloadCorpus(db, fetcher);
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns ok content with re-download metadata for a public page", async () => {
    const entry = await corpus.get_content("ok1");
    expect(entry?.outcome).toBe("ok");
    if (entry?.outcome === "ok") {
      expect(entry.content.content).toContain("hi");
      expect(entry.content.title).toBe("Public Title");
      expect(entry.content.author).toBe("Ada Lovelace");
      expect(entry.content.content_hash).toBe("a".repeat(64));
    }
  });

  it("reports an excluded page as unavailable with no content", async () => {
    const entry = await corpus.get_content("auth1");
    expect(entry?.outcome).toBe("auth_redirect");
    expect(entry && "content" in entry).toBe(false);
    if (entry && entry.outcome !== "ok") {
      expect(entry.reason).toContain("login");
    }
  });

  it("returns null when no metadata row exists", async () => {
    expect(await corpus.get_content("does-not-exist")).toBeNull();
  });

  it("logs fidelity + parsed meta to webpage_fetch for an ok fetch (AC#3/#4)", async () => {
    await corpus.get_content("ok1");
    const fetch = await get_latest_webpage_fetch(db, "ok1");
    expect(fetch?.outcome).toBe("ok");
    expect(fetch?.http_status).toBe(200);
    expect(fetch?.content_hash).toBe("a".repeat(64));
    expect(fetch?.author).toBe("Ada Lovelace");
    expect(fetch?.published_at).toBe("2026-01-01T00:00:00Z");
    expect(Date.parse(fetch!.fetched_at)).toBeGreaterThan(0);
  });

  it("logs an exclusion with a null content hash (AC#4)", async () => {
    await corpus.get_content("auth1");
    const fetch = await get_latest_webpage_fetch(db, "auth1");
    expect(fetch?.outcome).toBe("auth_redirect");
    expect(fetch?.content_hash).toBeNull();
  });

  it("iterates only the re-downloadable public subset (AC#7)", async () => {
    const titles: string[] = [];
    for await (const page of corpus.iter_public_pages()) {
      titles.push(page.title);
    }
    expect(titles).toEqual(["Public Title"]); // the auth page is excluded
  });
});

/** Seeds a webpage_capture metadata row whose `url` is the fetch target. */
async function seed_capture(db: DuckDB, id: string, url: string): Promise<void> {
  await store_capture(db, {
    page_session_id: id,
    url,
    html: "<html><head><title>seed</title></head><body>seed</body></html>",
    content_type: "text/html",
    captured_at: "2026-06-08T00:00:00.000Z",
  });
}
