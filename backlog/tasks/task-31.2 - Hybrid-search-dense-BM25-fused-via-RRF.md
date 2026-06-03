---
id: TASK-31.2
title: "Hybrid search: dense + BM25 fused via RRF"
status: To Do
assignee: []
created_date: "2026-06-02 12:21"
labels: []
dependencies:
  - TASK-31.1
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Enable LanceDB-native hybrid retrieval — the lowest-cost highest-ROI retrieval upgrade — on the existing store. Add a full-text/BM25 (Tantivy) index alongside the dense vector index, issue a hybrid query, and fuse results with Reciprocal Rank Fusion (RRFReranker is LanceDB's built-in default) via the embedded TypeScript SDK, so no separate search engine is needed. Make the semantic/BM25 weighting configurable (Anthropic's default ~0.8 semantic / 0.2 BM25 is the starting point) and tune it on the harness. Wire the new retrieval path into the MCP semantic_search tool. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase D).


**Learning companion:** [backlog/docs/rag-explainers/02-hybrid-search.html](02-hybrid-search.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A BM25/FTS index exists alongside the dense index in LanceDB
- [ ] #2 semantic_search runs a hybrid query fused via RRF through the TypeScript SDK
- [ ] #3 The semantic-vs-BM25 fusion weighting is configurable
- [ ] #4 Hybrid retrieval shows a measured improvement over the dense baseline on the harness
<!-- AC:END -->
