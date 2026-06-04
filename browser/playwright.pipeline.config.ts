import { defineConfig } from "@playwright/test";

// Full-pipeline E2E: drives the real extension against the live Bergamot
// capture server (no mock, no MOCK_PKM_PORT). The build and the server are
// managed by scripts/run-pipeline-e2e.mjs, so there is no globalSetup here.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/full_pipeline.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    trace: "retain-on-failure",
  },
});
