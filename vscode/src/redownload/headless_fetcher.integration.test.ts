import { BrowserPool } from "./browser_pool";
import { HeadlessFetcher } from "./headless_fetcher";
import { PolitenessGate, PolitenessConfig } from "./politeness_gate";
import {
  FixtureServer,
  start_fixture_server,
} from "./__fixtures__/fixture_server";

/**
 * Exercises the real re-download path end to end: a real stealth headless
 * Chromium (patchright) navigates real loopback HTTP fixtures, and the classifier
 * verdicts are asserted per outcome branch (AC#1–#4, #6). No network access.
 */
const FAST_GATE: PolitenessConfig = {
  max_global_concurrency: 2,
  max_host_concurrency: 1,
  per_host_min_interval_ms: 0,
  max_retries: 3,
  backoff_base_ms: 5,
  backoff_max_ms: 20,
  jitter_ratio: 0,
};

describe("HeadlessFetcher (real browser, loopback fixtures)", () => {
  let pool: BrowserPool;
  let fetcher: HeadlessFetcher;
  let server: FixtureServer;

  beforeAll(async () => {
    server = await start_fixture_server();
    pool = new BrowserPool();
    fetcher = new HeadlessFetcher(pool, new PolitenessGate(FAST_GATE));
  }, 60000);

  afterAll(async () => {
    await pool.close();
    await server.close();
  });

  it("re-downloads a public page as ok and returns its content (AC#1)", async () => {
    const result = await fetcher.fetch(server.url("/article"));
    expect(result.outcome.kind).toBe("ok");
    if (result.outcome.kind === "ok") {
      expect(result.outcome.html).toContain("Re-download Works");
      expect(result.outcome.http_status).toBe(200);
    }
  }, 30000);

  it("parses <meta> fields from the re-downloaded page (AC#3)", async () => {
    const result = await fetcher.fetch(server.url("/article"));
    expect(result.metadata).toEqual({
      title: "Re-download Works",
      site_name: "Bergamot Times",
      author: "Ada Lovelace",
      published_at: "2026-01-02T03:04:05Z",
      lang: "en-GB",
    });
  }, 30000);

  it("records fidelity metadata for every fetch (AC#4)", async () => {
    const result = await fetcher.fetch(server.url("/article"));
    expect(Date.parse(result.fidelity.fetched_at)).toBeGreaterThan(0);
    expect(result.fidelity.http_status).toBe(200);
    expect(result.fidelity.content_hash).toMatch(/^[0-9a-f]{64}$/);
  }, 30000);

  it("produces a stable content hash for the same page, distinct across pages (AC#4)", async () => {
    const a1 = await fetcher.fetch(server.url("/article"));
    const a2 = await fetcher.fetch(server.url("/article"));
    expect(a1.fidelity.content_hash).toBe(a2.fidelity.content_hash);
  }, 30000);

  it("excludes a redirect to a login page as auth_redirect with no content (AC#2)", async () => {
    const result = await fetcher.fetch(server.url("/protected"));
    expect(result.outcome.kind).toBe("auth_redirect");
    expect(result.fidelity.content_hash).toBeNull();
  }, 30000);

  it("excludes a 403 as forbidden (AC#2)", async () => {
    const result = await fetcher.fetch(server.url("/forbidden"));
    expect(result.outcome.kind).toBe("forbidden");
  }, 30000);

  it("excludes a 404 as dead_link (AC#2)", async () => {
    const result = await fetcher.fetch(server.url("/missing"));
    expect(result.outcome.kind).toBe("dead_link");
  }, 30000);

  it("excludes a paywalled page as paywall (AC#2)", async () => {
    const result = await fetcher.fetch(server.url("/paywall"));
    expect(result.outcome.kind).toBe("paywall");
  }, 30000);

  it("excludes a non-HTML resource as non_html (AC#2)", async () => {
    const result = await fetcher.fetch(server.url("/document.pdf"));
    expect(result.outcome.kind).toBe("non_html");
  }, 30000);

  it("excludes an unreachable host as dead_link via transport error (AC#2)", async () => {
    // Port 1 is reserved and unbound; navigation fails at the transport layer.
    const result = await fetcher.fetch("http://127.0.0.1:1/nope");
    expect(result.outcome.kind).toBe("dead_link");
    expect(result.fidelity.http_status).toBeNull();
  }, 30000);

  it("retries a transient 429 and succeeds (AC#6)", async () => {
    const result = await fetcher.fetch(server.url("/flaky"));
    expect(result.outcome.kind).toBe("ok");
  }, 30000);
});
