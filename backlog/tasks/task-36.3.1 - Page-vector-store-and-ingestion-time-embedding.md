---
id: TASK-36.3.1
title: "Page-vector store + ingestion-time embedding"
status: To Do
assignee: []
created_date: "2026-06-23 00:00"
updated_date: "2026-06-23 00:00"
labels: []
dependencies:
  - TASK-36.3
  - TASK-39.2
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36.3
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Production integration of the pure page-vectorisation library (TASK-36.3): make the page vector a durable artifact produced **at ingestion**, when a page reaches the extension, rather than lazily on TDT's own schedule. This is the natural extension of the eager re-download — the same `on_captured` pass that re-downloads a freshly captured page and warms the encrypted content cache also embeds it once and stores the vector, so every downstream consumer (TDT clustering, later RAG) only ever **reads** vectors.

This subtask delivers three pieces that TASK-36.3 deliberately left out of the pure library:

1. **Concrete `VectorStore`** — a DuckDB-backed implementation of the `@bergamot/tdt` `VectorStore` port over a `topic_page_vector(page_session_id, embedding_model_id, vector, repr, built_at)` table in the existing encrypted metadata DuckDB file, written only through the extension's single writer. (Vectors stay in the encrypted store — LanceDB was evaluated and rejected; see TASK-36.3 decisions. Similarity search via `array_cosine_similarity` / `vss` is deferred to RAG/TASK-31.)
2. **Ingestion-time embedding** — extend the visit-queue `on_captured` flow ([vscode/src/visit_queue_processor.ts](../../vscode/src/visit_queue_processor.ts)) so that, after the eager re-download extracts a page's public content, the extension maps that `CorpusContent` → `PageContent`, calls `build_page_vector` with the canonical model + representation, and persists the result via the concrete `VectorStore`. This runs **off the capture hot path** (fire-and-forget, on a worker / off the extension-host event loop, mirroring the clustering-worker pattern) so a slow or failing embed never stalls capture. `resolve_page_vector`'s build-on-miss becomes the backfill / alternate-model-or-repr path.
3. **Right-to-forget cascade** — add `topic_page_vector` to the cascade in [vscode/src/right_to_forget.ts](../../vscode/src/right_to_forget.ts) (constitution principle 4): forgetting a page deletes its vectors, with the cascade tests extended to cover it. The cascade module already reserves this slot ("TDT … vectors … added here when those stores exist").

The canonical embedding model + representation become extension/ingestion config (the local model is loaded in the extension host). A model or representation change yields a new `embedding_model_id` (the representation-rule version is folded into it), so historical pages are re-embedded lazily via `resolve_page_vector`'s build-on-miss or an explicit backfill pass.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §3 (single-writer store), §4 ("Where vectorisation runs"), §8 (`topic_page_vector` DDL), build order step 3a.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A DuckDB-backed VectorStore implements the @bergamot/tdt VectorStore port over topic_page_vector in the encrypted metadata file, written only through the extension's single writer
- [ ] #2 A captured public page's L2-normalized vector is present in topic_page_vector after ingestion (the on_captured eager-re-download pass), without TDT or any clustering run having executed
- [ ] #3 Embedding runs off the capture hot path: a slow or failing embed never stalls or delays visit-queue throughput
- [ ] #4 The canonical embedding model + representation are configuration; a model or representation change yields a new embedding_model_id and historical pages re-embed via build-on-miss or an explicit backfill
- [ ] #5 topic_page_vector joins the right-to-forget cascade in right_to_forget.ts — forgetting by url / origin / time-range deletes the affected page vectors — and the cascade tests are extended to cover it
- [ ] #6 Auth-walled / paywalled / dead / non-HTML pages (absent from the re-download corpus) produce no vector; no zero/NaN vector is ever stored

<!-- AC:END -->
