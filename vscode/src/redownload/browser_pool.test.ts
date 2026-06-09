import { BrowserPool } from "./browser_pool";

/**
 * Lifecycle guarantees for the shared re-download browser: it launches lazily,
 * closes cleanly, and close() is safe both before any launch and when racing an
 * in-flight launch (which must not leak an untracked Chromium).
 */
describe("BrowserPool lifecycle", () => {
  it("is not launched until first use and close() before launch is a no-op", async () => {
    const pool = new BrowserPool();
    expect(pool.is_launched()).toBe(false);
    await expect(pool.close()).resolves.toBeUndefined();
    expect(pool.is_launched()).toBe(false);
  });

  it("launches lazily on first with_page and closes idempotently", async () => {
    const pool = new BrowserPool();
    const url = await pool.with_page(async (page) => {
      await page.setContent("<html><body>ok</body></html>");
      return page.url();
    });
    expect(url).toBe("about:blank");
    expect(pool.is_launched()).toBe(true);
    await pool.close();
    expect(pool.is_launched()).toBe(false);
    await expect(pool.close()).resolves.toBeUndefined();
  }, 30000);

  it("does not leave a browser launched when close() races an in-flight launch", async () => {
    const pool = new BrowserPool();
    // Start a launch and close() before it settles; close() awaits the launch and
    // tears down whatever it created, so the pool ends up un-launched.
    const fetch = pool
      .with_page(async (page) => page.url())
      .catch(() => "aborted");
    await pool.close();
    await fetch;
    expect(pool.is_launched()).toBe(false);
  }, 30000);
});
