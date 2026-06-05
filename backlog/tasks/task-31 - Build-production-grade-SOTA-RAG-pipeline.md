---
id: TASK-31
title: Build production-grade SOTA RAG pipeline
status: To Do
assignee: []
created_date: '2026-06-02 12:21'
updated_date: '2026-06-05 19:22'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Upgrade Bergamot's MCP RAG from a naive whole-page, pure-dense baseline to a measured, state-of-the-art retrieval pipeline, so the project stands as portfolio-grade proof of production RAG engineering. The plan is grounded in fact-checked 2024-2026 research (Anthropic Contextual Retrieval, LanceDB-native hybrid search, reranking, MTEB-driven embedding selection, RAGAS-style evaluation) and is fully specified in backlog/docs/rag-pipeline-upgrade-plan.md. This supersedes the broad scope of task-30 by turning it into an ordered, measured, phased implementation. Each phase is an atomic, testable PR delivered as a sub-task.

**Learning companion:** [backlog/docs/rag-explainers/index.html](index.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every retrieval change is measured as a delta against a recorded baseline via the evaluation harness — no unmeasured "improvements" are merged
- [ ] #2 The shipped pipeline reaches clean ingestion + contextual chunking + hybrid retrieval (dense + BM25 fused via RRF) + reranking on the existing LanceDB + DuckDB store
- [ ] #3 The embedding model is selected by measured retrieval quality on Bergamot's own golden dataset rather than headline MTEB averages
- [ ] #4 MCP tool results return citations/attribution and the retrieval configuration is exposed/configurable
- [ ] #5 Advanced architectures (GraphRAG / Agentic / Self-RAG / CRAG / temporal topic clustering) are deferred via a decision record rather than silently dropped
- [ ] #6 backlog/docs/rag-pipeline-upgrade-plan.md remains the canonical reference and stays in sync with what ships
- [ ] #7 Time is a first-class retrieval signal — time-intent queries are served by a relative-time pre-filter + recency rerank over the existing visit timestamps, measured on the harness
- [ ] #8 The vector store is searchable through MCP in both modes via a single semantic_search tool: non-time-based topic search by default, and time-based search via optional time_range + time_reranked (recency) parameters
<!-- AC:END -->
