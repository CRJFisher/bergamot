---
id: TASK-35.7
title: Add the single Haiku summary+topics call over clean extracted markdown
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-04 18:01'
labels: []
dependencies:
  - TASK-35.4
  - TASK-35.5
references:
  - vscode/src/workflow/prompts.ts
  - vscode/src/workflow/simple_workflow.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the remaining analysis call shape with a single small SUMMARY_PROMPT (role 'fast' / Haiku) returning {summary, topics} over the clean extracted markdown. Skip the call entirely whenever the current keep/drop decision drops the page — at this commit that is the still-present classifier (should_process_page); after task-35.8 the deterministic gate swaps underneath without touching this code. Fall back to the extractor's excerpt/description when the call fails or returns non-JSON (folds task-34 AC#2: record offending stage + snippet, never crash). Net happy path: one Haiku call; dropped pages: zero.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single complete_json call with SUMMARY_PROMPT returns {summary, topics} from extracted markdown
- [ ] #2 The summary call is skipped for any dropped page (0 LLM calls); asserted via an injected jest.fn() LLM mock (as in simple_workflow.test.ts) — complete_json toHaveBeenCalledTimes(1) for a kept fixture and (0) for a dropped fixture — not FakeLLMClient, which has no call counter
- [ ] #3 On LLM failure/non-JSON, falls back to the extractor excerpt and records stage + snippet without crashing (folds task-34 AC#2)
- [ ] #4 ANALYSIS_PROMPT (old shape) is deleted
<!-- AC:END -->
