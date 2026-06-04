import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { TestPageServer } from "./test_page_server";

/**
 * Fixtures for the full-pipeline E2E (`full_pipeline.spec.ts`).
 *
 * Unlike `fixtures.ts`, there is no mock server and no `MOCK_PKM_PORT`: the
 * extension performs real port-range discovery against the live Bergamot
 * capture server (started by `scripts/run-pipeline-e2e.mjs`). The service-worker
 * console error hook is always on and collected so the spec can fail the run if
 * the extension logged any errors.
 */

const BROWSER_ROOT = process.cwd();
const EXTENSION_PATH = path.resolve(BROWSER_ROOT, "chrome");
const HEADLESS = !process.env.HEADED;

async function get_service_worker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  try {
    return await context.waitForEvent("serviceworker", { timeout: 10_000 });
  } catch {
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

type TestFixtures = {
  context: BrowserContext;
  service_worker: Worker;
  /** Service-worker console error lines collected over the test. */
  sw_errors: string[];
};

type WorkerFixtures = {
  page_server: TestPageServer;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
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
    await use(context);
    await context.close();
  },

  sw_errors: async ({ context }, use) => {
    const errors: string[] = [];
    const attach = (sw: Worker) =>
      sw.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
    context.serviceWorkers().forEach(attach);
    context.on("serviceworker", attach);
    await use(errors);
  },

  service_worker: async ({ context }, use) => {
    await use(await get_service_worker(context));
  },

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
});

export const expect = test.expect;

/** Resolves the live capture server's base URL from its canonical port file. */
export function server_base_url(): string {
  const port_file = path.join(os.homedir(), ".bergamot", "port.json");
  const { port } = JSON.parse(fs.readFileSync(port_file, "utf8"));
  return `http://localhost:${port}`;
}

/**
 * Polls the live server's relational query endpoint until the given URL has
 * been ingested all the way into DuckDB (capture is asynchronous: page load →
 * content script → background → POST → queue → workflow → store).
 */
export async function wait_for_stored(
  url: string,
  timeout = 20_000
): Promise<{ url: string; title: string; visited_at: string }> {
  const base = server_base_url();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/query/visit_by_url?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const row = await res.json();
      if (row && row.url === url) return row;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url} to be stored`);
}
