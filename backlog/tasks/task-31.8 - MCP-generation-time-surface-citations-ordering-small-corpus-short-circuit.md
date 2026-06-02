---
id: TASK-31.8
title: "MCP generation-time surface: citations, ordering, small-corpus short-circuit"
status: To Do
assignee: []
created_date: "2026-06-02 12:22"
labels: []
dependencies:
  - TASK-31.3
  - TASK-31.4
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Polish the generation-time / MCP surface. (1) Return citations/attribution (source URL + chunk) in MCP tool results. (2) Order context to combat lost-in-the-middle (most relevant at the edges). (3) Use structured outputs for results. (4) Expose retrieval config knobs (hybrid weights, rerank toggle, top-N) through the MCP layer. (5) Small-corpus short-circuit: when the knowledge base is under ~200K tokens (~500 pages), offer a whole-corpus-in-prompt path instead of retrieval, per Anthropic guidance. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase H).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 MCP results include citations/attribution (source URL and chunk)
- [ ] #2 Retrieved context is ordered to mitigate lost-in-the-middle
- [ ] #3 Retrieval configuration (weights/rerank/top-N) is exposed through the MCP layer
- [ ] #4 A small-corpus (<~200K tokens) whole-corpus-in-prompt path exists and is selected automatically when applicable
<!-- AC:END -->
