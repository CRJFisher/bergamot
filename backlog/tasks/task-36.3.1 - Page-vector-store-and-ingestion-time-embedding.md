---
id: TASK-36.3.1
title: "Page-vector store + batched embedder (vectorise ahead of TDT)"
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
  - backlog/drafts/tdt-embedding-model-selection.md
parent_task_id: TASK-36.3
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Production integration of the pure page-vectorisation library (TASK-36.3): make the page vector a durable artifact, produced by a **batched embed pass that runs ahead of a TDT clustering run** rather than per-page on the capture hot path. The content is already durably cached at capture time (the eager re-download warms the encrypted content cache), so embedding does not need to happen at ingestion — the embed pass reads the already-extracted public content from the cache, vectorises every page missing a current-model vector in one batched pass off the extension-host event loop, and stores the result. Every downstream consumer (TDT clustering, later RAG) then only ever **reads** vectors.

This subtask delivers four pieces that TASK-36.3 deliberately left out of the pure library:

1. **Concrete `VectorStore`** — a DuckDB-backed implementation of the `@bergamot/tdt` `VectorStore` port over a `topic_page_vector(page_session_id, embedding_model_id, vector, repr, built_at)` table in the existing encrypted metadata DuckDB file, written only through the extension's single writer. (Vectors stay in the encrypted store — LanceDB was evaluated and rejected; see TASK-36.3 decisions. Similarity search via `array_cosine_similarity` / `vss` is deferred to RAG/TASK-31.)
2. **Local embedder (production `EmbedFn`)** — the canonical model, `bge-small-en-v1.5` (q8, 384-d), run **fully offline** through `@huggingface/transformers` (`feature-extraction`, mean-pool + L2-normalize, no instruction prefix). Loaded from a bundled/cached artifact with `allowRemoteModels=false` (no network / no API call — the privacy guarantee), constructed once per pass and released after. ONNX Runtime is pinned to single-threaded sequential execution for best-effort reproducibility. See backlog/drafts/tdt-embedding-model-selection.md.
3. **Batched embed pass (vectorise ahead of TDT)** — a pass that iterates the re-downloadable public corpus (`iter_public_pages()`, cache-served) and, for each page, resolves its vector via `resolve_page_vector` build-on-miss with the canonical model + representation, persisting through the concrete `VectorStore`. A page already vectorised under the current `embedding_model_id` is a cache hit and is skipped. The pass runs **off the extension-host event loop** (a worker, mirroring the planned clustering-worker pattern) so the CPU-bound embed never blocks the UI or the `/visit` capture endpoint — and never touches the capture hot path at all. It is invokable as a standalone trigger and is the step a later TDT run executes before clustering.
4. **Right-to-forget cascade** — add `topic_page_vector` to the cascade in [vscode/src/right_to_forget.ts](../../vscode/src/right_to_forget.ts) (constitution principle 4): forgetting a page deletes its vectors, with the cascade tests extended to cover it. The cascade module already reserves this slot ("TDT … vectors … added here when those stores exist").

The canonical embedding model + representation are extension config. A model or representation change yields a new `embedding_model_id` (the representation-rule version is folded into it: `bge-small-en-v1.5/q8/384#repr-v1`), so historical pages are re-embedded by the next embed pass via `resolve_page_vector` build-on-miss — a clean cache miss, not a stale hit.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §3 (single-writer store), §4 ("Where vectorisation runs"), §8 (`topic_page_vector` DDL), build order step 3a; backlog/drafts/tdt-embedding-model-selection.md (model, lifecycle, determinism).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A DuckDB-backed VectorStore implements the @bergamot/tdt VectorStore port over topic_page_vector in the encrypted metadata file, written only through the extension's single writer
- [ ] #2 Running the batched embed pass populates topic_page_vector with an L2-normalized vector for each re-downloadable public page (content served from the durable cache) via resolve_page_vector build-on-miss; a page already vectorised under the current embedding_model_id is skipped (cache hit, no re-embed)
- [ ] #3 The embed pass runs off the capture path and does not block the extension-host event loop: the capture/visit-queue path performs no embedding, and the inference (async onnxruntime-node, executed off the JS event loop) plus inter-page yielding keep the UI and the /visit endpoint responsive during a pass
- [ ] #4 The production EmbedFn is the local bge-small-en-v1.5 model run via @huggingface/transformers fully offline (allowRemoteModels=false, no network/API call), loaded once per pass from a bundled/cached artifact and released after, with ONNX pinned to single-threaded sequential execution
- [ ] #5 The canonical embedding model + representation are configuration; a model or representation change yields a new embedding_model_id (bge-small-en-v1.5/q8/384#repr-v1) and the next embed pass re-embeds affected pages via build-on-miss
- [ ] #6 topic_page_vector joins the right-to-forget cascade in right_to_forget.ts — forgetting by url / origin / time-range deletes the affected page vectors — and the cascade tests are extended to cover it
- [ ] #7 Auth-walled / paywalled / dead / non-HTML pages (absent from the re-download corpus) produce no vector; no zero/NaN vector is ever stored

<!-- AC:END -->
