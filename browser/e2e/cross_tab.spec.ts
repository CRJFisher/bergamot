import { test, expect, wait_for_visit } from "./fixtures";

// Cross-page sessions: a new tab opened from a page must stay in the SAME
// navigation session (group_id) as its opener and record the opener as referrer.
// This is the scenario the old CDP harness could not drive.

test("new tab via target=_blank inherits the opener's group and referrer", async ({
  context,
  mock_server,
  page_server,
  service_worker,
}) => {
  expect(service_worker).toBeTruthy();

  const page_a = await context.newPage();
  await page_a.goto(page_server.url("/page-a"));
  const visit_a = await wait_for_visit(mock_server, (v) => v.url.includes("/page-a"));
  expect(visit_a.group_id).toBeTruthy();

  // Clicking a target=_blank link opens a second tab in the same context.
  const [page_b] = await Promise.all([
    context.waitForEvent("page"),
    page_a.click("#to-b-new-tab"),
  ]);
  await page_b.waitForLoadState("domcontentloaded");

  const visit_b = await wait_for_visit(mock_server, (v) => v.url.includes("/page-b"));

  // Same session across tabs, and the opener is the referrer.
  expect(visit_b.group_id).toBe(visit_a.group_id);
  expect(visit_b.referrer).toContain("/page-a");
});

test("window.open new tab stays in the opener's group", async ({
  context,
  mock_server,
  page_server,
  service_worker,
}) => {
  expect(service_worker).toBeTruthy();

  const page_a = await context.newPage();
  await page_a.goto(page_server.url("/page-a"));
  const visit_a = await wait_for_visit(mock_server, (v) => v.url.includes("/page-a"));

  const [page_d] = await Promise.all([
    context.waitForEvent("page"),
    page_a.click("#open-d"),
  ]);
  await page_d.waitForLoadState("domcontentloaded");

  const visit_d = await wait_for_visit(mock_server, (v) => v.url.includes("/page-d"));
  expect(visit_d.group_id).toBe(visit_a.group_id);
});

test("same-tab navigation keeps the group and chains the referrer", async ({
  context,
  mock_server,
  page_server,
  service_worker,
}) => {
  expect(service_worker).toBeTruthy();

  const page = await context.newPage();
  await page.goto(page_server.url("/page-a"));
  const visit_a = await wait_for_visit(mock_server, (v) => v.url.includes("/page-a"));

  await page.click("#to-c-same-tab");
  await page.waitForLoadState("domcontentloaded");

  const visit_c = await wait_for_visit(mock_server, (v) => v.url.includes("/page-c"));
  expect(visit_c.group_id).toBe(visit_a.group_id);
  expect(visit_c.referrer).toContain("/page-a");
});
