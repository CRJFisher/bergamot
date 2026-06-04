import { defineConfig } from "@playwright/test";

// e2e suite for the MV3 extension. A single MOCK_PKM_PORT is baked into one
// build (see global_setup), so the whole run shares one mock server and must
// execute on a single worker.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // The full-pipeline spec needs the real capture server (no mock, no baked
  // MOCK_PKM_PORT); it runs only via scripts/run-pipeline-e2e.mjs using
  // playwright.pipeline.config.ts.
  testIgnore: "**/full_pipeline.spec.ts",
  globalSetup: "./e2e/global_setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "retain-on-failure",
  },
});
