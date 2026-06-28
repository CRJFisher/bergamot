/**
 * Owns the single headless Chromium used for re-download. Patchright is a
 * stealth-patched drop-in for Playwright: it hides the automation signals
 * (`navigator.webdriver`, CDP leaks, headless UA) that anti-bot defenses use to
 * block headless browsers, so genuinely public pages re-download as content
 * instead of being lost to an interstitial.
 *
 * Stealth widens PUBLIC coverage only. The context is ephemeral and carries no
 * user cookies or profile, so the browser visits every page as an anonymous
 * stranger — authenticated and paywalled pages still fail and are excluded. The
 * login wall remains the privacy filter.
 *
 * The browser is launched lazily on first use, one shared ephemeral context is
 * reused, and each fetch gets a fresh page that is always closed. The browser is
 * closed on server shutdown to avoid leaking a Chromium process.
 */
import type { Browser, BrowserContext, Page } from "patchright";
import {
  ensure_browser_provisioned,
  resolve_browsers_path,
} from "./browser_provisioner";

/** Resource types aborted on every request: never needed to read text + `<meta>`. */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

/** Swallows a rejected cleanup/teardown promise; such failures are not actionable. */
const ignore_error = (): void => undefined;

export interface BrowserPoolOptions {
  /** Run with a visible window (debugging only). Defaults to headless. */
  headless?: boolean;
  /**
   * Surfaced once when a fetch finds no Chromium on disk and the one-time
   * download starts; receives the install's completion promise (the host
   * shows a progress notification). Fetches keep failing fast — and the read
   * path keeps serving 503 — until the install completes.
   */
  on_browser_provisioning?: (done: Promise<void>) => void;
}

/** The page-running capability the fetcher depends on (injectable in tests). */
export interface PageRunner {
  with_page<T>(fn: (page: Page) => Promise<T>): Promise<T>;
}

export class BrowserPool implements PageRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;
  /** Set once close() runs, so a launch in flight at shutdown tears itself down. */
  private closed = false;

  constructor(private readonly options: BrowserPoolOptions = {}) {}

  /**
   * Runs `fn` on a fresh page that is always closed afterwards. The shared
   * browser and context are launched on first call and reused thereafter, so a
   * fetch never pays the launch cost twice.
   */
  async with_page<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.ensure_context();
    const page = await context.newPage();
    page.on("dialog", (dialog) => {
      // A modal dialog (alert/confirm/beforeunload) would otherwise hang the fetch.
      void dialog.dismiss().catch(ignore_error);
    });
    try {
      return await fn(page);
    } finally {
      await page.close().catch(ignore_error);
    }
  }

  /** Closes the browser and clears state. Idempotent. Call on server shutdown. */
  async close(): Promise<void> {
    this.closed = true;
    // Wait for any in-flight launch to settle so we close the browser it created
    // rather than racing it (which would leak an untracked Chromium).
    const launching = this.launching;
    if (launching) await launching.catch(ignore_error);
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.launching = null;
    if (browser) await browser.close().catch(ignore_error);
  }

  /** True once the browser has been launched and not yet closed. */
  is_launched(): boolean {
    return this.browser !== null;
  }

  private async ensure_context(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      // The browsers directory must be pinned before patchright first loads
      // (its registry reads PLAYWRIGHT_BROWSERS_PATH at module load), which
      // is why the import is lazy and lives behind the resolver.
      resolve_browsers_path();
      const { chromium } = await import("patchright");
      ensure_browser_provisioned(
        chromium.executablePath(),
        this.options.on_browser_provisioning
      );
      const browser = await chromium.launch({
        headless: this.options.headless ?? true,
      });
      // If close() ran while this launch was in flight, tear down the browser we
      // just created instead of adopting it — otherwise it leaks untracked.
      if (this.closed) {
        await browser.close().catch(ignore_error);
        throw new Error("browser pool closed during launch");
      }
      // A Chromium crash nulls the singletons so the next fetch relaunches cleanly.
      browser.on("disconnected", () => {
        if (this.browser === browser) {
          this.browser = null;
          this.context = null;
          this.launching = null;
        }
      });
      // No storageState and no persistent profile: the context is cookie- and
      // credential-free, so every page is fetched as an anonymous stranger. This
      // is what makes the login wall the privacy filter — authenticated and
      // paywalled pages fail to render content and are excluded.
      const context = await browser.newContext();
      await context.route("**/*", (route) => {
        if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
          void route.abort().catch(ignore_error);
        } else {
          void route.continue().catch(ignore_error);
        }
      });
      this.browser = browser;
      this.context = context;
      this.launching = null;
      return context;
    })();

    // A failed launch (e.g. Chromium still being provisioned) must not pin
    // every later fetch to the same cached rejection — clear it so the next
    // fetch retries, succeeding once the browser exists.
    const launch = this.launching;
    launch.catch(() => {
      if (this.launching === launch) {
        this.launching = null;
      }
    });
    return launch;
  }
}
