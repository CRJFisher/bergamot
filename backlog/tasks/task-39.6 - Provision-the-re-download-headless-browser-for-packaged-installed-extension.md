---
id: TASK-39.6
title: Provision the re-download headless browser for packaged/installed extension
status: Done
assignee:
  - claude
created_date: '2026-06-09 12:02'
updated_date: '2026-06-10 09:26'
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
- [x] #1 On a freshly packaged + installed extension (no dev node_modules, no pre-existing ms-playwright cache), the re-download read path returns content for a public page — i.e. the headless browser launches
- [x] #2 patchright's JS is resolvable at runtime in the packaged VSIX (bundled or shipped), and the shared native-dep packaging decision (incl. @duckdb/node-api) is recorded
- [x] #3 Chromium is provisioned on first use into an app-owned dir (PLAYWRIGHT_BROWSERS_PATH under ~/.bergamot), once, cached across sessions and updates, for the host architecture
- [x] #4 Provisioning never blocks extension activation; a one-time progress notification is surfaced, and until the browser exists the read path reports the existing 503 'unavailable' rather than crashing
- [x] #5 The VSIX size stays within marketplace limits (the browser binary is NOT bundled in the package)
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in 6801c8b (feature) + 5257e2a (five-lens review fixes).

MECHANISM (diverged from the plan's .vscodeignore-negation idea — recorded in docs/decisions/native-dep-packaging.md): vsce hard-excludes node_modules under --no-dependencies and ships whatever physically exists under default mode, so the negation-whitelist approach was abandoned for a clean staging directory: esbuild bundles the three entrypoints (inlining all pure-JS deps, which workspace hoisting hid from vsce), builds/staging receives exactly the bundles + a manifest trimmed to the two shipped externals (@duckdb/node-api, patchright) + their transitive closure, and `vsce package --target <host>` runs there. The VSIX is platform-targeted, with the staged duckdb binding asserted to match. scripts/bundle_manifest.mjs is the single source of truth; scripts/check-bundle-externals.mjs fails the build on any unshipped bare specifier or a non-lazy patchright require.

PROVISIONING: browser_provisioner.ts pins PLAYWRIGHT_BROWSERS_PATH to ~/.bergamot/ms-playwright (pre-set env respected) before patchright loads (the registry reads it at module load — hence the lazy import in browser_pool); first fetch with no Chromium starts a single-flight `patchright install chromium` via process.execPath + ELECTRON_RUN_AS_NODE and fails fast; the read path serves its 503 until done; extension.ts surfaces a one-time withProgress notification; activation never blocks.

Review process: five parallel Fable reviews (correctness, packaging, architecture, testing, docs). Decisive findings applied: (1) unhandled-rejection crash — a failed install with no observer (the headless server) killed the process; the promise now always carries a catch (found by two reviewers, test pinned); (2) the VSIX was UNTARGETED with darwin-x64-only binaries — would install anywhere and die; --target wired + binding assert + target in the artifact name; (3) legacy packaging paths (npm run package, package-all.sh/js, publish-openvsx fallback) still produced the old broken dep-less VSIX — all rewired to the production build; (4) staging shipped the dead tsc tree incl. test mocks/fixtures — now exactly the three bundles (301→263 files); (5) a unit-test run on a machine without ~/.bergamot/ms-playwright would have spawned a real CDN download from jest — the browser suites now mock the provisioning gate; launch-retry-after-failure pinned; (6) in-flight install check reordered before the executable check (mid-extraction partial-tree launch); (7) MCP child spawned bare `node` (pre-existing; packaged installs cannot assume PATH node) — now execPath + ELECTRON_RUN_AS_NODE; (8) size figures unified (~250 MB download / ~570 MB on disk) including the user-facing notification; README discloses the first-run download; threat model names what the CDN observer learns; PUBLISHING.md/scripts-README/WORK_PRIORITY de-staled.

Verification evidence: bergamot-0.1.0-darwin-x64.vsix (38.5 MB, TargetPlatform=darwin-x64, browser NOT bundled — AC#5); fresh-install simulation (unzipped VSIX, empty browsers dir, bundled headless server under plain node): first /query/capture_content returned the provisioning 503, the one-time install completed in ~40s, and the re-read returned live content for https://example.com/ — AC#1; the VSIX also installs cleanly into real VS Code (bergamot.bergamot@0.1.0, then uninstalled to avoid a packaged capture server running beside dev). Remaining AC#1 caveat (recorded, not blocking): the extension-HOST activation path (Electron, globalStorageUri, SecretStorage, withProgress) was exercised only by unit tests + the simulation, not a full editor session; the ELECTRON_RUN_AS_NODE spawn branch is untested under real Electron. 282 jest tests + full-pipeline e2e green; dev machine's ~/.bergamot/ms-playwright seeded so dev == packaged behavior.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The re-download fetcher now works on an end-user install. Packaging: the extension ships as esbuild bundles (every pure-JS dep inlined — workspace hoisting had hidden them from vsce, which is why no install ever had patchright or express) plus exactly the two unbundleable runtime externals (@duckdb/node-api with its native binding, patchright with its browser registry), staged with their transitive closure into a clean directory and packaged as a platform-targeted VSIX (38.5 MB; the browser is not bundled). bundle_manifest.mjs + check-bundle-externals.mjs guard the contract on every build; all legacy packaging paths run the production build. Provisioning: Chromium (~250 MB download, ~570 MB on disk) is installed once, on first content fetch, into ~/.bergamot/ms-playwright via a single-flight `patchright install chromium`; until it completes the content read path serves its normal 503 and the extension shows a one-time progress notification — activation never blocks, a failed download degrades to per-fetch retry (never an unhandled rejection), and the cache survives sessions and extension updates. Verified end-to-end from an unzipped VSIX with an empty browsers directory: 503 → one-time install → live public-page content; the VSIX also installs cleanly into real VS Code. The shared native-dep packaging decision (including @duckdb/node-api) is recorded in docs/decisions/native-dep-packaging.md, and the first-run CDN download is a named egress in the threat model and the README.
<!-- SECTION:FINAL_SUMMARY:END -->
