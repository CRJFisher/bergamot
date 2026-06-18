---
id: TASK-42
title: Opt-in live session content capture from browser extension
status: To Do
assignee: []
created_date: "2026-06-18"
labels:
  - capture
  - privacy
  - settings
dependencies:
  - TASK-40
references:
  - browser/src/core/data_collector.ts
  - browser/src/core/visit_compression.ts
  - browser/src/background.ts
  - browser/chrome/manifest.json
  - vscode/src/server/server_manager.ts
  - vscode/src/duck_db_models.ts
  - docs/constitution.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add an opt-in setting that captures the full rendered HTML of a page as seen by the user — including authenticated state — rather than (or in addition to) the re-downloaded public copy. When enabled, the browser extension reads `document.body.outerHTML` at visit time, zstd-compresses it in the background service worker, and sends it to the VSCode extension via the `/visit` endpoint. The VSCode extension stores the decompressed HTML in the encrypted content cache.

This enables the content cache to cover pages behind login walls (dashboards, paywalled articles, internal tools) that the re-downloader cannot reach. It is an explicit privacy trade-off: the user is granting Bergamot access to rendered authenticated HTML. The setting must carry a clear warning to that effect and must default to off.

**Intent-tree node:** STORE — the content cache tier, specifically covering the login-walled gap the re-downloader leaves.
**Cheapest change:** revival of the exact wire format and compression pipeline removed in task-39.1 (commit `27a346f`), gated by a config flag checked on both sides.
**Destructive-delete plan:** replaces nothing; augments the existing re-download path.

### Reviving the old pattern

The content capture pipeline was fully working as of commit **`3a38b9d`** (2026-06-04, "fix: capture pages on strict-CSP sites by moving zstd compression to the background SW"). It was removed six days later in commit **`27a346f`** (2026-06-09, "feat(39.1): metadata-only capture — stop ambient content capture + schema reset").

The diff of `27a346f` is the exact inverse of what needs to be restored. Key pieces:

**Browser side — restore from `3a38b9d`:**

- `browser/src/core/data_collector.ts`
  - `MAX_CONTENT_BYTES = 2_000_000` (2 MB raw cap before compression)
  - `extract_page_content(): string` — reads `document.body?.outerHTML ?? ""`
  - `compress_content(content, zstd): Promise<string>` — UTF-8 encode → zstd.compress → base64
  - `create_visit_data()` included a `content` field (raw HTML, uncompressed — compression moved to background SW in `3a38b9d`)

- `browser/src/core/visit_compression.ts` (file deleted in `27a346f`; full source visible in `3a38b9d`'s diff)
  - `make_lazy_zstd(load)` — self-healing WASM loader; a failed compile is not cached so the next visit retries
  - `compress_visit_content(request, get_zstd, report)` — called in the background SW before forwarding to `/visit`; on compression failure sends empty content rather than raw HTML to avoid poisoning the store

- `browser/src/background.ts` — called `compress_visit_content()` on outbound `sendToPKMServer` messages

- `browser/package.json` — add `@hpcc-js/wasm-zstd`

- `browser/chrome/manifest.json` — `content_security_policy.extension_pages` must include `wasm-unsafe-eval` (needed so the background service worker's CSP permits WebAssembly; the strict-CSP fix in `3a38b9d` is the reason compression lives in the background SW, not the content script)

**VSCode side — restore from before `27a346f`:**

- `vscode/package.json` — add `@mongodb-js/zstd`

- `vscode/src/server/server_manager.ts`
  - Import `decompress` from `@mongodb-js/zstd`
  - `MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024` — zip-bomb guard; reject payloads that decompress above 10 MB
  - Express body limit: raise from `1mb` back to `50mb` (pages compress well but the base64 envelope is large)
  - In the `/visit` handler: if `req.body.content` is a non-empty string, base64-decode then zstd-decompress it; reject oversized results with a `decompress_failed` dev-log entry

- Schema: restore `content_compressed`, `content_encoding`, `original_byte_size` columns to `webpage_capture` (or add to the content-cache table — align with how task-39.3/39.10 laid out the encrypted content cache)

- Model: restore `content` field to `PageActivitySession`; the `PageActivitySessionWithoutContent` variant was also dropped in `39.1` — decide whether to restore it or fold content into the existing `WithoutTree` variant

**Note:** the `page_gate.ts` / `gate_metrics.ts` LLM-based capture gate that also existed before `39.1` should NOT be revived — it was already dead code by that point and is not part of this feature.

### Setting design

- Config key (provisionally): `capture.liveSessionContent` — boolean, default `false`
- The setting appears in the extension's settings UI with a warning label explaining that enabling it allows Bergamot to read and store authenticated page HTML including logged-in content
- The browser extension reads the setting from the `/status` endpoint (or equivalent config channel) at startup; only sends `content` when the setting is on
- The VSCode extension only stores content when the setting is on; content arriving while the setting is off is silently dropped (defence-in-depth)
- The right-to-forget cascade (task-39.5) already covers the content cache; live-session content stored here is subject to the same deletion path
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 With the setting off (default), `/visit` payloads carry no `content` field and nothing is stored — existing behaviour unchanged, verified by test
- [ ] #2 With the setting on, `document.body.outerHTML` is zstd-compressed in the background SW and sent as a base64 `content` field; the VSCode extension decompresses and stores it in the encrypted content cache
- [ ] #3 Pages on strict-CSP sites (e.g. `script-src 'self'`, no `wasm-unsafe-eval`) are still captured with metadata; if compression fails, `compression_failed` is logged and an empty body is stored rather than dropping the visit
- [ ] #4 A decompressed payload exceeding 10 MB is rejected with a `decompress_failed` dev-log entry; no content is stored for that visit
- [ ] #5 The setting exposes a warning in the VS Code settings UI that makes the privacy trade-off explicit before the user enables it
- [ ] #6 The right-to-forget cascade (task-39.5) deletes live-session content alongside re-downloaded content — no separate deletion path required
<!-- AC:END -->
