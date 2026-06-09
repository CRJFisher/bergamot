---
id: TASK-39.6
title: Provision the re-download headless browser for packaged/installed extension
status: To Do
assignee: []
created_date: '2026-06-09 12:02'
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
