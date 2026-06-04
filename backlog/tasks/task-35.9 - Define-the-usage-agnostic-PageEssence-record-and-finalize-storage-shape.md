---
id: TASK-35.9
title: Define the usage-agnostic PageEssence record and finalize storage shape
status: To Do
assignee: []
created_date: '2026-06-04 17:33'
updated_date: '2026-06-04 18:02'
labels: []
dependencies:
  - TASK-35.8
  - TASK-35.7
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
Rename webpage_analysis -> webpage_essence, keyed by page_session_id TEXT PRIMARY KEY (corrected spelling) as the STABLE page id that task-31.3 chunk records will foreign-key to. Columns: page_session_id, markdown TEXT NOT NULL (the canonical, durable full-page content — DuckDB is the source of truth so it survives task-31.3 replacing the whole-page LanceDB record with chunks), title, summary, topics(JSON), author, site_name, published_at, word_count, lang, lead_image_url (no intentions). Rename idx_analysis_title -> idx_essence_title; insert_webpage_analysis -> insert_page_essence. Introduce PageEssence type {page_session_id, title, summary, topics, markdown, excerpt (transient draft field used only as the 35.7 summary fallback at write time — NOT a stored column), author?, site_name?, published_at?, lang?, word_count?, lead_image_url?} replacing PageAnalysis; PageActivitySessionWithMeta.analysis -> essence. Update the LanceDB webpage_content record to {page_session_id, pageContent: markdown, url, title, summary, topics, word_count} (page_session_id + word_count carried so generation-time citation and the task-31.8 small-corpus budget need no extra DuckDB round-trip; richer citation fields site_name/author/published_at are fetched from webpage_essence via the page_session_id join). Update ALL webpage_analysis references in duck_db.ts: the three LEFT JOIN sites (~758, ~955, ~1340) plus the direct selects (~1172, ~1234). Delete dead readers get_all_pages_for_rag and get_webpage_analysis_for_ids (zero non-test callers); the durable parent-page read path becomes webpage_essence.markdown by page_session_id, which task-31.3 adds its chunk<->page reader against. The LanceDB webpage_content table must be force-recreated per task-35.3 (the new summary/topics/word_count fields are dimension-unchanged and will NOT auto-drop). Destructive dev-DB reset.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 webpage_analysis renamed webpage_essence, keyed by page_session_id TEXT PRIMARY KEY, with columns: markdown TEXT NOT NULL (canonical full-page content), title, summary, topics(JSON), author, site_name, published_at, word_count, lang, lead_image_url (no intentions); idx_analysis_title -> idx_essence_title; insert_webpage_analysis -> insert_page_essence; all webpage_analysis references updated (the three LEFT JOIN sites ~758/~955/~1340 plus the direct selects ~1172/~1234)
- [ ] #2 PageEssence replaces PageAnalysis across models and all callers (no shims); type includes page_session_id + topics; excerpt is documented as a transient summary-fallback draft field, not a stored column; PageActivitySessionWithMeta exposes essence
- [ ] #3 LanceDB webpage_content record stores {page_session_id, pageContent: markdown, url, title, summary, topics, word_count}
- [ ] #4 A test asserts the full canonical markdown is readable from webpage_essence by page_session_id independent of LanceDB, giving task-31.3 a durable parent-page source and a stable chunk<->page foreign key; richer citation fields (site_name/author/published_at) are reachable via that join
- [ ] #5 Dead readers get_all_pages_for_rag and get_webpage_analysis_for_ids deleted with their tests/mocks; the parent-page read path (webpage_essence.markdown by page_session_id) is documented for task-31.3
- [ ] #6 The LanceDB webpage_content table is force-recreated per task-35.3 (new summary/topics/word_count fields are dimension-unchanged and will NOT auto-drop); dev-DB reset procedure followed; intentions removal verified non-blocking for retrieval (topics retained as the keyword signal; BM25 will index the full markdown)
<!-- AC:END -->
