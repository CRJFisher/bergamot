import { BrowserPool } from "./browser_pool";
import {
  BrowserProvisioningError,
  ensure_browser_provisioned,
} from "./browser_provisioner";

// The provisioning gate is mocked so a machine without ~/.bergamot/ms-playwright
// can never trigger a real CDN download from a unit-test run; the real
// resolve_browsers_path and error class are kept so launches stay genuine.
jest.mock("./browser_provisioner", () => ({
  ...jest.requireActual("./browser_provisioner"),
  ensure_browser_provisioned: jest.fn(),
}));

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

  it("retries the launch after a provisioning failure instead of caching the rejection", async () => {
    (ensure_browser_provisioned as jest.Mock).mockImplementationOnce(() => {
      throw new BrowserProvisioningError();
    });
    const pool = new BrowserPool();

    await expect(pool.with_page(async (page) => page.url())).rejects.toThrow(
      BrowserProvisioningError
    );
    // The cleared launch slot lets this second call run a real launch.
    await expect(pool.with_page(async (page) => page.url())).resolves.toBe(
      "about:blank"
    );
    await pool.close();
  }, 30000);
});
