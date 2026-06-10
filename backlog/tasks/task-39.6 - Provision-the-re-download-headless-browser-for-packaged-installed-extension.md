---
id: TASK-39.6
title: Provision the re-download headless browser for packaged/installed extension
status: In Progress
assignee:
  - claude
created_date: '2026-06-09 12:02'
updated_date: '2026-06-10 07:53'
labels:
  - packaging
  - privacy
  - fetcher
  - release
dependencies:
  - TASK-39.2
references:
  - vscode/src/redownload/browser_pool.ts
  - vscode/scripts/build-production.js
  - vscode/.vscodeignore
  - >-
    backlog/tasks/task-39.2 -
    Re-download-post-processing-content-fetcher-and-content-read-path.md
parent_task_id: TASK-39
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the re-download fetcher (task-39.2) actually run on an end-user install. Today it works only in dev, where the workspace `node_modules` and a locally-downloaded Chromium happen to be present. On a packaged install it fails: the read path degrades to a 503 "unavailable" and never returns content.

Two gaps:

1. **patchright JS is not shipped.** The VSIX is built with `vsce package --no-dependencies` (vscode/scripts/build-production.js) and `.vscodeignore` excludes `**/node_modules/**`, so `import { chromium } from "patchright"` does not resolve at runtime. NOTE: `@duckdb/node-api` (the existing native runtime dep) has the same problem — runtime/native-dep packaging is unsolved for the whole extension, not just patchright. Decide the shared strategy: bundle runtime deps (e.g. esbuild that inlines patchright + keeps the native `.node` resolvable), or stop using `--no-dependencies` for true runtime deps.

2. **Chromium is not provisioned.** patchright's ~150 MB browser downloads out-of-band into the ms-playwright cache; nothing installs it on a user machine. Bundling it in the VSIX is rejected (size / marketplace limits). Provision on first run instead: spawn `patchright install chromium` into an app-owned dir via `PLAYWRIGHT_BROWSERS_PATH` (e.g. `~/.bergamot/ms-playwright`), one-time, cached across sessions/updates, arch-correct (Intel x64 dev machine + Apple Silicon + Windows/Linux), with a surfaced "downloading content fetcher…" notification, gated so it never blocks activation. The fetcher already degrades to a 503 "unavailable" until the browser exists, so this layers on cleanly.

Out of scope: pointing patchright at a user's system Chrome (loses the stealth-patched build) — note as a fallback only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a freshly packaged + installed extension (no dev node_modules, no pre-existing ms-playwright cache), the re-download read path returns content for a public page — i.e. the headless browser launches
- [ ] #2 patchright's JS is resolvable at runtime in the packaged VSIX (bundled or shipped), and the shared native-dep packaging decision (incl. @duckdb/node-api) is recorded
- [ ] #3 Chromium is provisioned on first use into an app-owned dir (PLAYWRIGHT_BROWSERS_PATH under ~/.bergamot), once, cached across sessions and updates, for the host architecture
- [ ] #4 Provisioning never blocks extension activation; a one-time progress notification is surfaced, and until the browser exists the read path reports the existing 503 'unavailable' rather than crashing
- [ ] #5 The VSIX size stays within marketplace limits (the browser binary is NOT bundled in the package)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Two gaps, one shared decision.

PACKAGING (gap 1 + the shared native-dep decision, AC#2): esbuild-bundle the three entrypoints (extension.ts, mcp_server_standalone.ts, server/server_standalone.ts) into self-contained CJS files in out/, externalizing exactly three things: `vscode` (host-provided), `@duckdb/node-api` (native binding), `patchright` (browser asset descriptors + dynamic requires make it unbundleable). All pure-JS deps (express, cors, zod, @modelcontextprotocol/sdk) are inlined — this also solves the workspace-hoisting problem (vsce cannot see root-hoisted deps, which is why express/patchright were never shipped). The externals ship inside the VSIX: .vscodeignore flips from blanket `**/node_modules/**` to a negation whitelist (`node_modules/@duckdb/**`, `node_modules/patchright/**`, `node_modules/patchright-core/**`); the production build stages root-hoisted patchright + patchright-core into vscode/node_modules before `vsce package --no-dependencies` (vsce's npm dep walk is useless under workspaces — the flag plus explicit whitelist is the recorded strategy). The VSIX is platform-specific by construction (the installed @duckdb binding is the build host's); release builds target `vsce package --target <platform>`. Decision recorded in docs/decisions/native-dep-packaging.md.

PROVISIONING (gap 2): new vscode/src/redownload/browser_provisioner.ts — resolves PLAYWRIGHT_BROWSERS_PATH (respect a pre-set env var, else pin to ~/.bergamot/ms-playwright and set it before patchright loads), checks chromium's executablePath on disk, and provisions once via `node patchright/cli.js install chromium` with that env (singleton in-flight promise, surfaced through an injectable on_provisioning callback). browser_pool.ts imports patchright lazily (the env must be decided before playwright-core computes its registry dir) and ensures provisioning before launch: while the download runs, fetches throw a "provisioning" error and the read path keeps serving its existing 503 — activation is never blocked. extension.ts wires the callback to a one-time vscode.window.withProgress notification.

VERIFICATION (AC#1/#5 best-effort on this machine): package the VSIX, unzip to a temp dir, resolve patchright/@duckdb from the unzipped layout with node (no repo node_modules), run the bundled server_standalone from it against a fresh PLAYWRIGHT_BROWSERS_PATH, provision, and fetch a public page through /query/capture_content; record VSIX size (browser binary not bundled).

Docs: decision record; threat model §C gains the first-run browser download (Playwright CDN) as a named egress; architecture docs touched where stale.
After implementation: five Fable subagent reviews, apply recommendations, then finalize.
<!-- SECTION:PLAN:END -->
