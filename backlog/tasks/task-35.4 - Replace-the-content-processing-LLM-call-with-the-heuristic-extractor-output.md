---
id: TASK-35.4
title: Replace the content-processing LLM call with the heuristic extractor output
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-04 18:02'
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
Now that extraction is proven on real captures, delete CONTENT_PROCESSING_PROMPT and the content-processing LLM call; the extractor's markdown becomes the canonical content fed to storage and (later) the summary call. This removes today's dominant per-page token cost (up to 100k chars of reduced HTML sent to Haiku). Keep html_reduce only as a fallback when extraction yields nothing. Folds task-34 AC#1 (empty content dropped cleanly). Field shape is unchanged (LanceDB pageContent stays a string), so no LanceDB recreate is required here; stale LLM-era rows are harmless and cleared by the task-35.3 reset if desired.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CONTENT_PROCESSING_PROMPT and its llm_client.complete call are deleted
- [ ] #2 Extracted markdown is the content written to LanceDB and used downstream; no LLM content-processing remains
- [ ] #3 When extraction yields empty/whitespace content the page is dropped with reason content_reduced_empty (folds task-34 AC#1) rather than entering analysis
- [ ] #4 Tests assert clean markdown flows through without the content LLM call
<!-- AC:END -->
