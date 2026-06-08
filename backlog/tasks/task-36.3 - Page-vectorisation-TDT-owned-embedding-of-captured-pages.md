---
id: TASK-36.3
title: "Page vectorisation: TDT-owned embedding of re-downloaded pages"
status: To Do
assignee: []
created_date: "2026-06-05 19:22"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.1
  - TASK-39.2
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Build the one-vector-per-page step that makes TDT independent of the RAG pipeline. This is where the "no task-31 dependency" property is realized: the embedding INPUT is RE-DOWNLOADED PUBLIC content, not captured/stored HTML (capture records metadata only). TDT reads the re-downloaded page (via the task-39.2 fetcher / content read path) plus its parsed <head> metadata, builds a deterministic page-level text (title + lead / main-content extract), embeds it with TDT's OWN injected local model, L2-normalizes, and caches the result. Visits with no re-downloadable public content (auth-walled / paywalled / dead) yield no vector and are excluded. Pages over the embedder's token budget are split into segments, embedded, and mean-pooled (a throwaway internal split — NOT RAG chunking; no contextual prefixes, no persisted chunks).

Correctness guards ship here: multi-topic dispersion → represent by dominant segment; degenerate near-zero vector → fallback; pages with no extractable text → excluded. Determinism is anchored by fixed-order float64 accumulation when pooling segments.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §4 (Data inputs & the page-vector problem).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 build_page_vector reads a re-downloaded public page (via the task-39.2 content read path) and returns one L2-normalized vector via the injected EmbedFn, with no dependency on RAG chunk vectors or LanceDB
- [ ] #2 Page vectors are cached in topic_page_vector keyed by (page_session_id, embedding_model_id); a model or representation change invalidates the cache
- [ ] #3 Guards are implemented: multi-topic dispersion falls back to the dominant segment, a degenerate near-zero vector falls back, and no-text pages are excluded
- [ ] #4 A determinism test shows the same re-downloaded page plus a pinned model yields a bitwise-identical page vector regardless of fetch order
- [ ] #5 Repeat same-URL visits within a navigation tree are deduped before clustering
- [ ] #6 Unit tests cover the guards, caching/invalidation, and determinism
<!-- AC:END -->
