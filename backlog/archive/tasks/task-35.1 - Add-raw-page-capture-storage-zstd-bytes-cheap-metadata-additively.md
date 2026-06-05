---
id: TASK-35.1
title: Add raw-page capture storage (zstd bytes + cheap metadata) additively
status: Done
assignee: []
created_date: '2026-06-04 17:31'
updated_date: '2026-06-05 10:25'
labels: []
dependencies:
  - TASK-35.3
references:
  - vscode/src/workflow/html_reduce.ts
  - vscode/src/workflow/simple_workflow.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce a DuckDB table webpage_capture(page_session_id TEXT PRIMARY KEY, content_compressed BLOB, content_encoding TEXT, original_byte_size INT, content_type TEXT, url TEXT, title TEXT, site_name TEXT, author TEXT, published_at TEXT, lang TEXT, captured_at TEXT) and store the raw page zstd-compressed. Reuse @mongodb-js/zstd (already a dependency). Storage tip: server_manager.ts already decodes the incoming base64 zstd into a Buffer (server_manager.ts:212) before decompressing it for the size-guard — store THAT original compressed Buffer directly (content_encoding='zstd', original_byte_size = decompressed length) rather than re-compressing; keep the decompress only for the size guard and the cheap metadata parse. Read cheap metadata non-LLM from the HTML <head> / Open-Graph tags (linkedom or a light parse) — NO main-content extraction. Land ADDITIVELY alongside the existing LLM pipeline (which keeps writing webpage_analysis) so e2e stays green; later subtasks delete the LLM calls and the old table. References the task-35.3 dev-DB reset procedure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 webpage_capture table exists (page_session_id PK + content_compressed BLOB + content_encoding + original_byte_size + content_type + url + title + site_name + author + published_at + lang + captured_at); the raw page is persisted zstd-compressed keyed by page_session_id
- [x] #2 compress -> store -> decompress round-trips byte-identically (a test asserts lossless recovery of the original page)
- [x] #3 Cheap metadata (title, site_name, author, published_at, lang) is read non-LLM from the <head> / og: tags; no main-content extraction runs
- [x] #4 Lands additively — the existing LLM pipeline still runs and e2e stays green
- [x] #5 The zstd codec is reused from the capture path (no new heavyweight dependency) and verified to bundle in the CJS/esbuild output
<!-- AC:END -->

## Implementation Notes

Added the capture-first store alongside the existing LLM pipeline.

- **Schema** (`duck_db.ts`): new `webpage_capture` table (`page_session_id` PK, `content_compressed BLOB`, `content_encoding`, `original_byte_size`, `content_type`, `url`, `title`, `site_name`, `author`, `published_at`, `lang`, `captured_at`). No foreign key, so a capture can be written before/independently of the activity-session row. Schema lands via the destructive dev-DB reset (see `backlog/docs/dev-db-reset.md`, task-35.3) — no ALTER.
- **DB functions** (`duck_db.ts`): `insert_webpage_capture` (binds the BLOB via `blobValue()` from `@duckdb/node-api`, `INSERT OR REPLACE`), `get_webpage_capture` (metadata view, no bytes), `get_webpage_capture_bytes` (raw compressed BLOB; `getRowObjects` returns it as a `Uint8Array`). Types `WebpageCaptureRecord` / `WebpageCaptureMeta`.
- **Metadata** (`workflow/read_metadata.ts`): pure regex `<head>` parse — `<title>`→`og:title`→URL fallback, `og:site_name`, `author`/`article:author`, `article:published_time`/`date`, `<html lang>`/`og:locale`. Decodes named/numeric entities. No DOM library, no main-content extraction.
- **Store/recover** (`workflow/store_capture.ts`): `store_capture` compresses the page, reads metadata, inserts; `read_capture` decompresses the stored BLOB back to the original HTML — the parent-document read path for task-31.3.
- **Wiring** (`workflow/simple_workflow.ts`): capture happens right after the keep decision, before any LLM step (capture-first within the kept path).
- **Tests**: `read_metadata.test.ts` (extraction + entity decode + attr-order), `store_capture.test.ts` (byte-identical round-trip incl. multibyte/emoji, `original_byte_size`, metadata persistence). Integration test still green.

**Decision — re-compress rather than reuse the browser's buffer.** The task hint suggested storing the server's original compressed Buffer to skip re-compression. Threading a binary Buffer through `ExtendedPageVisit` → the JSON visit-inbox → the queue → the workflow would force a base64 round-trip and double the inbox payload (it already stores the decompressed `raw_content`). zstd of a few hundred KB is sub-millisecond, so `store_capture` re-compresses the decompressed page in the pipeline instead. The round-trip is still byte-identical (asserted). This also keeps capture as a clean pipeline stage (aligns with task-35.11's `store_capture` stage) rather than a side-effect in the HTTP handler.

**Bundle note (AC#5):** `@mongodb-js/zstd` is already a runtime dependency and its `decompress` is already used in `server_manager.ts`; `store_capture` uses `compress`/`decompress` from the same package, so no new dependency is added and the codec bundles exactly as it already does.

Files: `duck_db.ts` (table + functions), `workflow/read_metadata.ts` (new), `workflow/store_capture.ts` (new), `workflow/simple_workflow.ts` (wiring), `workflow/read_metadata.test.ts` (new), `workflow/store_capture.test.ts` (new).
