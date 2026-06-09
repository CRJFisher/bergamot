import { test, expect, wait_for_stored } from "./pipeline_fixtures";

/**
 * Full real-pipeline E2E: a page load in the extension flows through real
 * server discovery → the live Bergamot capture server → DuckDB/LanceDB, with
 * the LLM and embeddings faked (offline, zero-token). Run via
 * `scripts/run-pipeline-e2e.mjs`, which builds the extension plainly and starts
 * the headless server before invoking this spec.
 */
test("captures a real page visit end to end into the store", async ({
  context,
  page_server,
  sw_errors,
  // requesting service_worker ensures the extension is loaded before navigating
  service_worker,
}) => {
  expect(service_worker).toBeTruthy();

  const page = await context.newPage();
  const url = page_server.url("/page-a");
  await page.goto(url);

  const stored = await wait_for_stored(url);
  expect(stored.url).toBe(url);
  // Title is captured directly from the tab (document.title); its presence in the
  // store proves the metadata-only capture pipeline ran end to end.
  expect(stored.title).toBe("Page A");

  // The extension must not have logged any service-worker errors during capture.
  expect(sw_errors).toEqual([]);
});
