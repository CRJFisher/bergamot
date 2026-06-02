---
id: TASK-31.7
title: "Query transformation: HyDE + multi-query (optional)"
status: To Do
assignee: []
created_date: "2026-06-02 12:22"
labels: []
dependencies:
  - TASK-31.2
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add optional query-side transformation, behind config and measured before defaulting on. (1) HyDE: generate a hypothetical answer document from the query and retrieve by its embedding (strong for zero-shot / label-poor retrieval). (2) Multi-query rewriting: expand a query into variants and merge results. (3) A lightweight router deciding whether to retrieve at all. Keep each a toggle; measure marginal gain on the harness and only enable by default if it pays. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase F).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 HyDE retrieval is available behind a config toggle
- [ ] #2 Multi-query expansion is available behind a config toggle
- [ ] #3 A router can decide whether retrieval is needed for a query
- [ ] #4 Each technique's marginal gain is measured on the harness and defaults are set by the result
<!-- AC:END -->
