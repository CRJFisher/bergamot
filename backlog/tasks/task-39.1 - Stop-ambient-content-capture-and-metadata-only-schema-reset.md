---
id: TASK-39.1
title: "Stop ambient content capture + metadata-only DuckDB schema reset"
status: To Do
assignee: []
created_date: "2026-06-08 13:30"
labels:
  - capture
  - schema
  - privacy
dependencies:
  - TASK-39.2
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - backlog/drafts/privacy-reorientation-plan.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Remove all ambient page-content capture and storage so the capture path writes metadata only. Destructive change, no backwards-compat shims (constitution rule).

BROWSER (stop reading/sending content): delete content extraction and compression — `extract_page_content`, `MAX_CONTENT_BYTES`, `compress_content` in `browser/src/core/data_collector.ts`; the whole `browser/src/core/visit_compression.ts` module and its wiring in `browser/src/background.ts`; the `@hpcc-js/wasm-zstd` dep. Remove `content` from `VisitData` (`browser/src/types/navigation.ts`) and all call sites. The visit payload becomes metadata only (url, title, page_loaded_at, session graph) — title/url/timestamp read directly from the tab.

SERVER (stop decompress + store): remove the decompress block and `MAX_DECOMPRESSED_BYTES` in `vscode/src/server/server_manager.ts`; stop populating any raw-content field; drop the `@mongodb-js/zstd` dep; reduce the inflated body limit.

SCHEMA (destructive reset, no migration): drop `content_compressed`, `content_encoding`, `original_byte_size` from `webpage_capture` in `vscode/src/duck_db.ts`; remove the BLOB write and `get_webpage_capture_bytes`. Update `store_capture.ts`, `page_capture_pipeline.ts`, `visit_queue_processor.ts`, `duck_db_models.ts`, `page_capture_models.ts`, `visit_replay.ts`, `orphaned_visits.ts` to carry no content. `read_metadata.ts`'s `<meta>` parsing moves to re-download (task-39.2); title still comes from the tab.

GATE: `page_gate.ts` keeps incognito refusal only; empty/auth/redirect dropping moves to re-download time (the gate no longer sees content).

TESTS/FIXTURES: rewrite or delete the capture/storage tests and obsolete HTML fixtures to the metadata-only contract — do NOT add shims to keep old tests green.

DEPENDS ON 39.2: the content read path must be repointed at re-download before stored content is dropped.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 The browser sends a metadata-only visit payload (no `content`, no compression); `visit_compression.ts` and the zstd dep are deleted
- [ ] #2 The server ingests metadata only; the decompress/store path and `@mongodb-js/zstd` are removed
- [ ] #3 The `webpage_capture` schema has no content/compression columns (`content_compressed`/`content_encoding`/`original_byte_size`), applied as a destructive reset with no migration shim
- [ ] #4 Title, URL, and load timestamp are captured directly from the tab; `<meta>`-derived fields are not read at capture
- [ ] #5 The capture gate keeps only incognito refusal; no content-based gating remains at capture
- [ ] #6 Browsing produces zero stored page content, verified by a test
- [ ] #7 The capture/storage test suite and obsolete fixtures are rewritten or deleted to the metadata-only contract (no shims kept to stay green); build and tests are green
<!-- AC:END -->
