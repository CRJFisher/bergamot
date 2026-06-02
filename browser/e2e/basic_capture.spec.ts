import { test, expect, wait_for_visit } from "./fixtures";

test("captures a page visit and assigns a group id", async ({
  context,
  mock_server,
  page_server,
  // requesting service_worker ensures the extension is loaded before we navigate
  service_worker,
}) => {
  expect(service_worker).toBeTruthy();

  const page = await context.newPage();
  await page.goto(page_server.url("/page-a"));

  const visit = await wait_for_visit(mock_server, (v) => v.url.includes("/page-a"));

  expect(visit.url).toContain("/page-a");
  expect(visit.group_id).toBeTruthy();
  expect(typeof visit.page_loaded_at).toBe("string");
});
