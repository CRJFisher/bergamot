---
id: TASK-31.3
title: Chunking + Contextual Retrieval + parent-document
status: To Do
assignee: []
created_date: "2026-06-02 12:22"
labels: []
dependencies:
  - TASK-31.1
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Replace whole-page embedding (currently each page is one LanceDB record) with the highest single-technique ROI upgrade. (1) Chunk pages structure-aware (markdown-header / recursive). (2) Apply Anthropic Contextual Retrieval: for each chunk, pass the chunk plus its full source page to an LLM to generate 50-100 tokens of chunk-specific situating context, prepended to the chunk before BOTH embedding and the BM25 index. (3) Parent-document retrieval: store chunk-to-page linkage (in DuckDB) so a chunk hit returns its full page, giving the agent complete context. Re-embed the corpus and measure against baseline (Anthropic: contextual embeddings alone -35% retrieval failures, +contextual BM25 -49%). Coordinate the contextual-BM25 half with the hybrid index from task-31.2. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase C).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Pages are split into structure-aware chunks instead of stored whole
- [ ] #2 Each chunk is embedded and BM25-indexed with an LLM-generated 50-100 token situating context prepended
- [ ] #3 DuckDB stores chunk-to-page linkage so a chunk hit can return its parent page
- [ ] #4 The corpus is re-embedded under the new scheme
- [ ] #5 Contextual chunking shows a measured retrieval-failure reduction vs the whole-page baseline on the harness
<!-- AC:END -->
