---
id: TASK-35.4
title: >-
  Stop sending page content to any LLM at ingest (delete content-processing +
  ingest embedding)
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-05 08:57'
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
Now that raw capture is stored (task-35.1), delete CONTENT_PROCESSING_PROMPT and the content-processing LLM call, and remove the whole-page embedding write to LanceDB at ingest — embeddings move to the RAG-prep pipeline (task-31.3). The raw page in webpage_capture is the durable content; extraction/embedding are deferred. Folds task-34 AC#1 (empty content dropped cleanly). Interim-search consequence: until task-31 builds the index, captured pages are not semantically searchable; whether to add a thin non-LLM interim whole-page embedding is a flagged decision recorded on task-35 (not done here by default).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CONTENT_PROCESSING_PROMPT and its llm_client.complete call are deleted
- [ ] #2 The whole-page LanceDB embedding write at ingest is removed (embedding deferred to the RAG-prep pipeline); the interim semantic_search behaviour is documented
- [ ] #3 No page content is sent to any LLM during ingestion
- [ ] #4 When the captured page is empty/whitespace it is dropped with reason content_empty (folds task-34 AC#1)
- [ ] #5 Tests assert capture proceeds with no content-processing LLM call
<!-- AC:END -->
