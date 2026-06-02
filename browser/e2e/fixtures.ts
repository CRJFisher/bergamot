import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { MockPKMServer } from "./mock_pkm_server";
import { TestPageServer } from "./test_page_server";

// Playwright runs from the browser/ workspace root, so resolve paths from cwd
// (avoids __dirname / import.meta differences under "type": "module").
const BROWSER_ROOT = process.cwd();
const EXTENSION_PATH = path.resolve(BROWSER_ROOT, "chrome");

// Headless by default (suitable for agentic coding / CI). Set HEADED=1 to watch.
const HEADLESS = !process.env.HEADED;

/**
 * Resolves the extension's MV3 service worker, tolerating the known flakiness
 * where `waitForEvent('serviceworker')` can hang in CI: it checks for an
 * already-registered worker first, then waits, then nudges the worker awake by
 * opening a page and retries.
 */
async function get_service_worker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing.length > 0) {
    return existing[0];
  }
  try {
    return await context.waitForEvent("serviceworker", { timeout: 10_000 });
  } catch {
    // Nudge: opening a page can trigger extension worker startup.
    const page = await context.newPage();
    await page.goto("about:blank").catch(() => undefined);
    const after = context.serviceWorkers();
    if (after.length > 0) {
      await page.close();
      return after[0];
    }
    const worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    await page.close();
    return worker;
  }
}

function read_mock_port(): number {
  const port_file = path.resolve(BROWSER_ROOT, "test-port.txt");
  const raw = fs.readFileSync(port_file, "utf8").trim();
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid mock port in ${port_file}: "${raw}"`);
  }
  return port;
}

type TestFixtures = {
  context: BrowserContext;
  service_worker: Worker;
  extension_id: string;
  clean_visits: void;
};

type WorkerFixtures = {
  mock_server: MockPKMServer;
  page_server: TestPageServer;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // The persistent context loads the built extension. channel:'chromium' uses
  // the full Chromium build (headless-shell cannot load extensions).
  // Playwright requires the object-destructuring pattern for the first arg; an
  // empty pattern means "no fixture dependencies".
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: HEADLESS,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    if (process.env.DEBUG_E2E) {
      const attach_sw_log = (sw: Worker) =>
        sw.on("console", (m) => console.log(`[SW] ${m.text()}`));
      context.on("serviceworker", attach_sw_log);
      context.serviceWorkers().forEach(attach_sw_log);
      context.on("page", (p) =>
        p.on("console", (m) => console.log(`[page] ${m.text()}`))
      );
    }
    await use(context);
    await context.close();
  },

  service_worker: async ({ context }, use) => {
    await use(await get_service_worker(context));
  },

  extension_id: async ({ service_worker }, use) => {
    // service worker URL: chrome-extension://<id>/dist/background.bundle.js
    await use(service_worker.url().split("/")[2]);
  },

  // One mock server for the whole worker, bound to the port baked into the
  // build. Recreating it per test would churn the fixed port while the browser
  // still holds keep-alive connections (flaky); instead start once and clear
  // visits before each test (see clean_visits).
  mock_server: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = new MockPKMServer(read_mock_port());
      await server.start();
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],

  page_server: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = new TestPageServer();
      await server.start();
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],

  // Auto fixture: each test starts with an empty visit log on the shared server.
  clean_visits: [
    async ({ mock_server }, use) => {
      mock_server.clear_visits();
      await use(undefined);
    },
    { auto: true },
  ],
});

export const expect = test.expect;

export type Visit = {
  url: string;
  referrer?: string;
  group_id?: string;
  opener_tab_id?: number;
  tab_id?: number;
  page_loaded_at?: string;
  [key: string]: unknown;
};

/**
 * Polls the mock server until a visit matching `predicate` is recorded, or the
 * timeout elapses. Returns the matching visit (capture is asynchronous: page
 * load -> content script -> background -> HTTP POST).
 */
export async function wait_for_visit(
  mock: MockPKMServer,
  predicate: (visit: Visit) => boolean,
  timeout = 8_000
): Promise<Visit> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = (mock.get_visits() as Visit[]).find(predicate);
    if (match) {
      return match;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const seen = (mock.get_visits() as Visit[]).map((v) => v.url);
  throw new Error(
    `Timed out waiting for matching visit. Recorded URLs: ${JSON.stringify(seen)}`
  );
}
