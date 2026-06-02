import { test, expect, wait_for_visit } from "./fixtures";

// SPA navigations (history.pushState) must be captured as visits within the
// same session as the initial page load.

test("captures history.pushState navigations in the same group", async ({
  context,
  mock_server,
  page_server,
  service_worker,
}) => {
  expect(service_worker).toBeTruthy();

  const page = await context.newPage();
  await page.goto(page_server.url("/spa"));
  const root = await wait_for_visit(mock_server, (v) => v.url.endsWith("/spa"));

  await page.click("#push-sub1");
  const sub1 = await wait_for_visit(mock_server, (v) => v.url.includes("/spa/sub1"));

  await page.click("#push-sub2");
  const sub2 = await wait_for_visit(mock_server, (v) => v.url.includes("/spa/sub2"));

  expect(sub1.group_id).toBe(root.group_id);
  expect(sub2.group_id).toBe(root.group_id);
});
