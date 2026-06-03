---
id: TASK-31.4
title: Reranking stage over hybrid candidates
status: To Do
assignee: []
created_date: "2026-06-02 12:22"
labels: []
dependencies:
  - TASK-31.2
  - TASK-31.3
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add a reranking stage over the top-N candidates returned by hybrid retrieval — the add-on that stacks to the largest cumulative failure reduction (Anthropic: -67% retrieval failures with contextual hybrid + rerank). Use a LanceDB-pluggable reranker (cross-encoder local, or a hosted reranker such as Cohere/Voyage) and choose the concrete one by measured ROI and cost on the harness, not by reputation. Expose reranker choice and top-N via config. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase E).


**Learning companion:** [backlog/docs/rag-explainers/04-reranking.html](04-reranking.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A reranking stage re-scores the top-N hybrid candidates before results are returned
- [ ] #2 At least two reranker options are benchmarked on the harness and one is selected by measured ROI
- [ ] #3 Reranker choice and candidate count are configurable
- [ ] #4 Reranking shows a measured improvement over hybrid-without-rerank on the harness
<!-- AC:END -->
