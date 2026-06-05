---
id: TASK-35.7
title: Remove the analysis LLM call (title/summary/intentions) from ingestion
status: Done
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-05 08:57'
labels: []
dependencies:
  - TASK-35.1
  - TASK-35.5
references:
  - vscode/src/workflow/prompts.ts
  - vscode/src/workflow/simple_workflow.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Delete the analysis LLM call entirely (ANALYSIS_PROMPT and its complete_json call). Title now comes from the cheap <head> metadata captured in task-35.1; summary and topics are deferred to the RAG-prep pipeline / query time and are NOT produced at ingest. Per-page intentions were already removed in task-35.5. After this lands, ingestion makes zero LLM calls — this is the subtask that takes the last model call out of capture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ANALYSIS_PROMPT and the analysis complete_json call are deleted; no summary/topics/intentions are produced at ingest
- [x] #2 Page title is sourced from the cheap <head> metadata captured in task-35.1 (no LLM)
- [x] #3 After this lands, ingestion makes ZERO LLM calls — asserted via an injected jest.fn() LLM mock (0 calls for any captured page)
- [x] #4 summary/topics are documented as deferred to the RAG-prep pipeline / query time
<!-- AC:END -->


## Implementation Notes

Removed the final LLM call from ingestion — the capture pipeline is now zero-LLM.

- **Workflow** (`workflow/simple_workflow.ts`): deleted the `ANALYSIS_PROMPT` `complete_json` call, the `get_llm_client` construction, `reduce_html_for_llm`, and the `insert_webpage_analysis` write. `run()` is now: gate → `store_capture` → record outcome. No model is invoked.
- **Title source**: page title comes from the cheap `<head>` metadata captured in task-35.1 (`read_metadata` → `webpage_capture.title`). No summary/topics/intentions are produced at ingest.
- **Prompts**: `workflow/prompts.ts` deleted (its last export, `ANALYSIS_PROMPT`, is gone; `CONTENT_PROCESSING_PROMPT` was already dead after task-35.4).
- **Zero-LLM proof**: `simple_workflow.test.ts` constructs the workflow with no LLM client and asserts a kept page is captured with no model call; the integration test runs the full seam with no `BERGAMOT_LLM` fake and asserts the title comes from `<head>` ("Integration").

summary/topics are deferred to the RAG-prep pipeline / query time (task-31), documented in the architecture docs.

Files: `workflow/simple_workflow.ts`, `workflow/prompts.ts` (deleted), `workflow/simple_workflow.test.ts`, `server/server_pipeline.integration.test.ts`.
