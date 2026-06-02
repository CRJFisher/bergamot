---
id: TASK-31
title: Build production-grade SOTA RAG pipeline
status: To Do
assignee: []
created_date: "2026-06-02 12:21"
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Upgrade Bergamot's MCP RAG from a naive whole-page, pure-dense baseline to a measured, state-of-the-art retrieval pipeline, so the project stands as portfolio-grade proof of production RAG engineering. The plan is grounded in fact-checked 2024-2026 research (Anthropic Contextual Retrieval, LanceDB-native hybrid search, reranking, MTEB-driven embedding selection, RAGAS-style evaluation) and is fully specified in backlog/docs/rag-pipeline-upgrade-plan.md. This supersedes the broad scope of task-30 by turning it into an ordered, measured, phased implementation. Each phase is an atomic, testable PR delivered as a sub-task.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Every retrieval change is measured as a delta against a recorded baseline via the evaluation harness — no unmeasured "improvements" are merged
- [ ] #2 The shipped pipeline reaches clean ingestion + contextual chunking + hybrid retrieval (dense + BM25 fused via RRF) + reranking on the existing LanceDB + DuckDB store
- [ ] #3 The embedding model is selected by measured retrieval quality on Bergamot's own golden dataset rather than headline MTEB averages
- [ ] #4 MCP tool results return citations/attribution and the retrieval configuration is exposed/configurable
- [ ] #5 Advanced architectures (GraphRAG / Agentic / Self-RAG / CRAG) are deferred via a decision record rather than silently dropped
- [ ] #6 backlog/docs/rag-pipeline-upgrade-plan.md remains the canonical reference and stays in sync with what ships
<!-- AC:END -->
