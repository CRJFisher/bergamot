---
id: TASK-35.10
title: >-
  Light golden-set eval: extraction coverage + Haiku summary acceptability +
  cost delta
status: To Do
assignee: []
created_date: "2026-06-04 17:33"
labels: []
dependencies:
  - TASK-35.8
  - TASK-35.7
references:
  - vscode/src/workflow/embeddings.test.ts
parent_task_id: TASK-35
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Create a ~20-30 page in-repo golden set (HTML fixtures under **fixtures**/ with references: is-article flag, expected title substring, human-written reference summary/topics), seeded from the user's corpus and grey-area types (GitHub, YouTube, news, product, docs). A colocated \*.test.ts asserts extractor coverage (markdown retains reference key passages; word_count within tolerance; non-article pages detected) and Haiku summary acceptability via deterministic keyword-overlap (LLM-as-judge optional, non-blocking). Run against real extractor output, not mocks. Record a before/after approximate tokens-per-page table in the task notes. Re-scopes task-22: do NOT build task-22's 300+ F1 set or task-31.1's RAGAS harness here.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 20-30 page golden set exists as fixtures with references, seeded from real + grey-area page types
- [ ] #2 Colocated test asserts extraction coverage and detects non-article pages; Haiku summary asserted non-empty, within budget, acceptable via deterministic keyword-overlap
- [ ] #3 Eval runs in CI against real extractor output and fails on coverage/summary regressions
- [ ] #4 A before/after tokens-per-page table is recorded (classify+content+analysis+occasional sonnet -> 1 Haiku summary)
- [ ] #5 No 300+ F1 or RAGAS harness is built in this task
<!-- AC:END -->
