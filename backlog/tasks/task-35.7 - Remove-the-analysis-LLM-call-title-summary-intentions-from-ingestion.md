---
id: TASK-35.7
title: Remove the analysis LLM call (title/summary/intentions) from ingestion
status: To Do
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
- [ ] #1 ANALYSIS_PROMPT and the analysis complete_json call are deleted; no summary/topics/intentions are produced at ingest
- [ ] #2 Page title is sourced from the cheap <head> metadata captured in task-35.1 (no LLM)
- [ ] #3 After this lands, ingestion makes ZERO LLM calls — asserted via an injected jest.fn() LLM mock (0 calls for any captured page)
- [ ] #4 summary/topics are documented as deferred to the RAG-prep pipeline / query time
<!-- AC:END -->
