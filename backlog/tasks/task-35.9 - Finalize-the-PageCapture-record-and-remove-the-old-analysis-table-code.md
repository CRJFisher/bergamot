---
id: TASK-35.9
title: Finalize the PageCapture record and remove the old analysis table/code
status: To Do
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
- [ ] #1 The old webpage_analysis table, insert_webpage_analysis, idx_analysis_title, the three LEFT JOIN sites (~758/~955/~1340) and the direct selects (~1172/~1234) are removed; webpage_capture is the sole canonical record
- [ ] #2 PageCapture replaces PageAnalysis across models and all callers (no shims); PageActivitySessionWithMeta.analysis -> capture (metadata only, no LLM-derived fields)
- [ ] #3 Tree queries read title from webpage_capture; navigation trees render with title + url (no summary/intentions)
- [ ] #4 Dead readers get_all_pages_for_rag and get_webpage_analysis_for_ids deleted with their tests/mocks; the parent-document read path for task-31.3 (decompress webpage_capture.content_compressed by page_session_id) is documented
- [ ] #5 The misspelled page_sesssion_id key is gone with PageAnalysis; dev-DB reset followed per task-35.3
<!-- AC:END -->
