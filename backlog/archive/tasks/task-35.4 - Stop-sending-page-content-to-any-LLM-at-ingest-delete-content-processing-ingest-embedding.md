---
id: TASK-35.4
title: >-
  Stop sending page content to any LLM at ingest (delete content-processing +
  ingest embedding)
status: Done
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-05 10:25'
labels: []
dependencies:
  - TASK-35.1
references:
  - vscode/src/workflow/prompts.ts
  - vscode/src/workflow/simple_workflow.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Now that raw capture is stored (task-35.1), delete CONTENT_PROCESSING_PROMPT and the content-processing LLM call, and remove the whole-page embedding write to LanceDB at ingest — embeddings move to the RAG-prep pipeline (task-31.3). The raw page in webpage_capture is the durable content. Folds task-34 AC#1 (empty content dropped cleanly). Decision (LOCKED): NO interim embedding — ingestion writes nothing to LanceDB; semantic_search returns empty until task-31 builds the index. Document that clearly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CONTENT_PROCESSING_PROMPT and its llm_client.complete call are deleted
- [x] #2 The whole-page LanceDB embedding write at ingest is removed; ingestion writes nothing to LanceDB; semantic_search returns empty until task-31 builds the index (documented) — no interim embedding is added
- [x] #3 No page content is sent to any LLM during ingestion
- [x] #4 When the captured page is empty/whitespace it is dropped with reason content_empty (folds task-34 AC#1)
- [x] #5 Tests assert capture proceeds with no content-processing LLM call and no LanceDB write
<!-- AC:END -->


## Implementation Notes

Ingestion no longer sends any page content to an LLM for extraction or embedding.

- **Content processing removed** (`workflow/simple_workflow.ts`): deleted the `CONTENT_PROCESSING_PROMPT` `llm_client.complete(...)` call and its import. The interim analysis call now reads the reduced HTML directly (the analysis call itself is removed in task-35.7).
- **No LanceDB write at ingest** (`workflow/simple_workflow.ts`): removed `memory_db.put(...)` and the unused `WEBPAGE_CONTENT_NAMESPACE` constant. Per the LOCKED decision, NO interim embedding is written — ingestion writes nothing to LanceDB, and `semantic_search` returns empty until task-31 builds the index. The raw page in `webpage_capture` is the durable content.
- **Empty drop (folds task-34 AC#1)**: a page whose `raw_content` is empty/whitespace is dropped early with reason `content_empty`, before capture and before any model call.
- **Tests**: `simple_workflow.test.ts` now asserts capture proceeds with no content-processing `complete` call and no `memory_db.put`; the integration test asserts the raw page round-trips from `webpage_capture` (not LanceDB) and that ingest writes nothing to LanceDB.

`memory_db` is now unused inside the workflow but remains a constructor dependency until the IA remodel (task-35.9/35.11) updates all callers.

Files: `workflow/simple_workflow.ts`, `workflow/simple_workflow.test.ts`, `server/server_pipeline.integration.test.ts`.
