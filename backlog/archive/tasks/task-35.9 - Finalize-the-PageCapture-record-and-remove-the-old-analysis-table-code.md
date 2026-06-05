---
id: TASK-35.9
title: Finalize the PageCapture record and remove the old analysis table/code
status: Done
assignee: []
created_date: '2026-06-04 17:33'
updated_date: '2026-06-05 10:25'
labels: []
dependencies:
  - TASK-35.7
  - TASK-35.8
  - TASK-35.3
references:
  - vscode/src/duck_db.ts
  - vscode/src/reconcile_webpage_trees_workflow_models.ts
  - vscode/src/lance_db.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the LLM calls gone (task-35.4/35.7), webpage_capture (task-35.1) is the canonical stored record. Remove the now-dead old store: the webpage_analysis table, insert_webpage_analysis, idx_analysis_title, the three LEFT JOIN sites in duck_db.ts (~758, ~955, ~1340) and the direct selects (~1172, ~1234), and the dead readers get_all_pages_for_rag and get_webpage_analysis_for_ids (zero non-test callers). Introduce the PageCapture type {page_session_id, url, title, site_name?, author?, published_at?, lang?, content_type, captured_at, original_byte_size} (metadata view; the raw bytes are read on demand) replacing PageAnalysis with no shims; PageActivitySessionWithMeta.analysis -> capture. Update the tree queries to read title from webpage_capture. NAMING: a content_compressed field already exists in get_webpage_content / duck_db.ts (~1270) but is a MISNOMER today (it returns content DEcompressed from LanceDB) — reconcile it so webpage_capture.content_compressed is genuinely the compressed bytes, and update get_webpage_content + server_pipeline.integration.test.ts (which asserts stored.content_compressed) accordingly. The parent-document source for task-31.3 is the raw page — decompress webpage_capture.content_compressed by page_session_id; document this read path. Destructive dev-DB reset per task-35.3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The old webpage_analysis table, insert_webpage_analysis, idx_analysis_title, the three LEFT JOIN sites (~758/~955/~1340) and the direct selects (~1172/~1234) are removed; webpage_capture is the sole canonical record
- [x] #2 PageCapture replaces PageAnalysis across models and all callers (no shims); PageActivitySessionWithMeta.analysis -> capture (metadata only, no LLM-derived fields)
- [x] #3 Tree queries read title from webpage_capture; navigation trees render with title + url (no summary/intentions)
- [x] #4 Dead readers get_all_pages_for_rag and get_webpage_analysis_for_ids deleted with their tests/mocks; the parent-document read path for task-31.3 (decompress webpage_capture.content_compressed by page_session_id) is documented
- [x] #5 The misspelled page_sesssion_id key is gone with PageAnalysis; dev-DB reset followed per task-35.3
<!-- AC:END -->


## Implementation Notes

`webpage_capture` is now the sole canonical per-page record.

- **Removed old store** (`duck_db.ts`): the `webpage_analysis` table + `WEBPAGE_ANALYSIS_TABLE` constant, `insert_webpage_analysis`, `idx_analysis_title`, `map_row_to_page_analysis`, `create_placeholders_and_params`, the dead readers `get_all_pages_for_rag` and `get_webpage_analysis_for_ids`, and `get_webpage_content` (LanceDB). The tree queries (`get_page_sessions_with_tree_id`, `get_last_modified_trees_with_members_and_analysis`) and `get_webpage_by_url` now `LEFT JOIN webpage_capture` and read the title from it (shared `CAPTURE_SELECT`). `get_page_by_title` queries `webpage_capture` and returns a `PageCapture`.
- **PageCapture type** (`reconcile_webpage_trees_workflow_models.ts`): `PageCaptureSchema`/`PageCapture` replaces `PageAnalysis`; `PageActivitySessionWithMeta.analysis` → `.capture`. `duck_db.WebpageCaptureRecord` now extends `PageCapture`; `get_webpage_capture` returns `PageCapture` (the old `WebpageCaptureMeta` alias removed).
- **content_compressed naming reconciled**: `webpage_capture.content_compressed` is genuinely the zstd-compressed bytes (BLOB). The old misnomer `get_webpage_content` (which returned DEcompressed LanceDB text as `content_compressed`) is gone. The parent-document read path for task-31.3 is `read_capture(db, page_session_id)` (decompress `webpage_capture.content_compressed`), exposed over HTTP as `/query/capture_content` and consumed by the MCP `get_webpage_content` tool.
- **upsert**: `insert_webpage_capture` uses `INSERT ... ON CONFLICT (page_session_id) DO UPDATE` (DuckDB did not honour `INSERT OR REPLACE` here).
- The misspelled `page_sesssion_id` is gone with `PageAnalysis`. Schema change applied via the dev-DB reset (task-35.3); no ALTER.
- Tests updated across `duck_db.test.ts`, `webpage_tree.test.ts`, integration test to assert `capture` metadata and the capture read path.

Files: `duck_db.ts`, `reconcile_webpage_trees_workflow_models.ts`, `workflow/store_capture.ts`, `server/server_manager.ts` (capture_content endpoint), `mcp_server_standalone.ts`, plus tests.
