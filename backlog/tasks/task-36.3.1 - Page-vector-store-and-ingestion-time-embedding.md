---
id: TASK-36.3.1
title: "Page-vector store + batched embedder (vectorise ahead of TDT)"
status: Done
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
2. **Local embedder (production `EmbedFn`)** — the canonical model, `bge-small-en-v1.5` (q8, 384-d), run **on-device** through `@huggingface/transformers` (`feature-extraction`, per-segment mean-pool; `build_page_vector` owns the L2-normalization, so the per-segment call is raw — `normalize: false`; no instruction prefix). **Inference never touches the network** (`allowRemoteModels=false`); the model is served from an on-disk cache, provisioned by a one-time public-weights download on first use (public weights only — never page content), after which remote fetches are disabled. The embedder is constructed once per pass and released after. ONNX Runtime is pinned to single-threaded sequential execution for best-effort reproducibility. See backlog/drafts/tdt-embedding-model-selection.md.
3. **Batched embed pass (vectorise ahead of TDT)** — a pass that iterates the re-downloadable public corpus (`iter_public_pages()`, cache-served) and, for each page, resolves its vector via `resolve_page_vector` build-on-miss with the canonical model + representation, persisting through the concrete `VectorStore`. A page already vectorised under the current `embedding_model_id` is a cache hit and is skipped. The pass is a plain async loop: the CPU-bound inference runs **off the JS event loop** on onnxruntime-node's libuv threadpool, and a yield between pages keeps the loop free — **no worker thread** (a worker could not hold the single-writer DuckDB handle to read the corpus or write the store), so the embed never blocks the UI or the `/visit` capture endpoint and never touches the capture hot path. It is invokable as a standalone trigger and is the step a later TDT run executes before clustering.
4. **Right-to-forget cascade** — add `topic_page_vector` to the cascade in [vscode/src/right_to_forget.ts](../../vscode/src/right_to_forget.ts) (constitution principle 4): forgetting a page deletes its vectors, with the cascade tests extended to cover it. The cascade module already reserves this slot ("TDT … vectors … added here when those stores exist").

The canonical embedding model + representation are extension config. A model or representation change yields a new `embedding_model_id` (the representation-rule version is folded into it: `bge-small-en-v1.5/q8/384#repr-v1`), so historical pages are re-embedded by the next embed pass via `resolve_page_vector` build-on-miss — a clean cache miss, not a stale hit.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §3 (single-writer store), §4 ("Where vectorisation runs"), §8 (`topic_page_vector` DDL), build order step 3a; backlog/drafts/tdt-embedding-model-selection.md (model, lifecycle, determinism).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 A DuckDB-backed VectorStore implements the @bergamot/tdt VectorStore port over topic_page_vector in the encrypted metadata file, written only through the extension's single writer
- [x] #2 Running the batched embed pass populates topic_page_vector with an L2-normalized vector for each re-downloadable public page (content served from the durable cache) via resolve_page_vector build-on-miss; a page already vectorised under the current embedding_model_id is skipped (cache hit, no re-embed)
- [x] #3 The embed pass runs off the capture path and does not block the extension-host event loop: the capture/visit-queue path performs no embedding, and the inference (async onnxruntime-node, executed off the JS event loop) plus inter-page yielding keep the UI and the /visit endpoint responsive during a pass
- [x] #4 The production EmbedFn is the local bge-small-en-v1.5 model run via @huggingface/transformers with inference fully offline (allowRemoteModels=false, no network/API call for inference; a one-time public-weights download provisions the on-disk cache), loaded once per pass and released after, with ONNX pinned to single-threaded sequential execution
- [x] #5 The canonical embedding model + representation are configuration; a model or representation change yields a new embedding_model_id (bge-small-en-v1.5/q8/384#repr-v1) and the next embed pass re-embeds affected pages via build-on-miss
- [x] #6 topic_page_vector joins the right-to-forget cascade in right_to_forget.ts — forgetting by url / origin / time-range deletes the affected page vectors — and the cascade tests are extended to cover it
- [x] #7 Auth-walled / paywalled / dead / non-HTML pages (absent from the re-download corpus) produce no vector; no zero/NaN vector is ever stored

<!-- AC:END -->

## Implementation Notes

### High-level summary

Page vectors are a durable artifact produced by a **batched embed pass that runs ahead of a TDT clustering run**, not per-page on the capture hot path. Because the eager re-download already caches each page's extracted public content, the pass reads that cached content, vectorises every page missing a current-model vector, and stores the result; clustering (and later RAG) only ever **read** vectors.

Four pieces land, all in `vscode/src/tdt/` (the pure `@bergamot/tdt` clustering library stays dependency-free; this is its first vscode-side consumer):

- **`PageVectorStore`** ([page_vector_store.ts](../../vscode/src/tdt/page_vector_store.ts)) — the concrete DuckDB implementation of the `@bergamot/tdt` `VectorStore` port over a new `topic_page_vector(page_session_id, embedding_model_id, vector FLOAT[], repr, built_at)` table in the **existing encrypted metadata DuckDB file** (created in `create_metadata_schema`). It wraps the extension's single writer, never opens its own connection, and upserts on the composite primary key. The vector is a DuckDB `FLOAT[]`, so the round-trip is byte-identical to the L2-normalized `Float32Array` and RAG can reuse the column for `array_cosine_similarity` with no later migration. `put` guards against empty/non-finite vectors as a last line of defence.
- **`load_local_embedder`** ([local_embedder.ts](../../vscode/src/tdt/local_embedder.ts)) — the production `EmbedFn`, `bge-small-en-v1.5` (q8, 384-d) run on-device through `@huggingface/transformers`. Inference never touches the network (`allowRemoteModels=false`); the model is served from an on-disk cache under the storage base, provisioned by a one-time public-weights download on first use (public weights only — never page content), after which remote fetches are re-locked. ONNX is pinned single-threaded sequential, which makes the same text embed byte-identically (verified on the Intel x64 target). The per-segment call is `pooling:"mean", normalize:false` — `build_page_vector` owns pooling across segments and the single final L2-normalization, per the `EmbedFn` contract.
- **`run_embed_pass`** ([embed_pass.ts](../../vscode/src/tdt/embed_pass.ts)) — iterates the cache-served public corpus (`iter_public_pages()`) and resolves each page via `resolve_page_vector` (skip-on-hit, build-on-miss, exclude-on-degenerate), reporting embedded / skipped / excluded / failed. Per-page errors are isolated so one bad page never aborts the backlog; a `setImmediate` yield between pages keeps the loop responsive. It is a plain async loop with no worker thread (the inference runs off the JS event loop on onnxruntime-node's libuv threadpool, and a worker could not hold the single-writer DuckDB handle anyway). `ServerManager.embed_pages()` runs it under a single-flight latch (one model load, no racing writes) and is the seam a clustering run will call before reading vectors; the `bergamot.tdt.embedPages` command triggers it manually today.
- **Right-to-forget cascade** ([right_to_forget.ts](../../vscode/src/right_to_forget.ts)) — a forgotten page's vectors are deleted **inside** `forget_metadata`'s transaction, keyed by the resolved `page_session_id`s (covering url / origin / time-range; vectors carry no URL), so they vanish atomically with the rows they derive from. The report carries `page_vectors_deleted` and the cascade tests assert deletion on every selector and survival under a rolled-back forget.

The embedding model + representation are configuration ([embedding_config.ts](../../vscode/src/tdt/embedding_config.ts)): `PAGE_EMBEDDING_MODEL_ID = bge-small-en-v1.5/q8/384#repr-v1` folds model + quantization + dim + representation-rule version into one cache key, so any change is a clean miss that the next pass re-embeds.

### Decisions

- **No worker thread (AC #3).** `onnxruntime-node`'s `run()` already executes inference off the JS event loop on libuv's threadpool, and a `worker_threads` worker could not open the single-writer metadata DuckDB to read the corpus or write the store. A plain async pass with an inter-page yield satisfies "off the event loop / capture path" with far less machinery — the original "(a worker)" framing was dropped.
- **Determinism is best-effort, not a release gate.** A page vector is built once and stored; clustering reads the stored bytes, so cross-run bitwise identity only matters on a re-embed (model change / backfill). Single-thread ONNX is pinned and the byte-identity is verified, but it is not a blocking guarantee across all platforms.
- **`@huggingface/transformers` pinned EXACT at 3.7.6.** Its `onnxruntime-node` 1.21.0 still ships the **darwin-x64** native binary the Intel-Mac target needs; 4.x's 1.24.x dropped it. The pin is load-bearing — bumping it requires re-running `npm run verify:embedder` and confirming the new onnxruntime still carries a darwin-x64 binary. This is documented in the embedder header.
- **Vectors as `FLOAT[]` in the encrypted metadata DB.** LanceDB was rejected (privacy) by TASK-36.3; `FLOAT[]` round-trips the float32 exactly and is the shape RAG's similarity search reuses. The table lives in the metadata file (not a separate store), so the forget delete is transactional with the metadata.
- **Real-model verification runs out-of-process.** onnxruntime-node's native typed-array validation is incompatible with jest's VM realm, so the wrapper logic is unit-tested with a mock and the real stack (384-d output, byte-identical determinism, strict-offline guard) is verified by `scripts/verify-embedder.mjs` (`npm run verify:embedder`).
- **`@bergamot/tdt` build ordering.** vscode now consumes the built `@bergamot/tdt` package, so the monorepo `workspaces` array lists `tdt` before `vscode` — otherwise a clean `npm run build` / `release:prepare` would compile vscode before tdt's `out/` exists and fail to resolve the package.

### Verification

301 vscode unit tests pass (page-vector store round-trip incl. byte-identity, embed-pass hit/skip/exclude/isolation/yield, embedder offline/provision/dispose via mock, single-flight coalescing, right-to-forget across all selectors). The real `bge-small-en-v1.5` q8 model was verified on Intel x64 macOS via `npm run verify:embedder`: 384-d output, byte-identical determinism, and a strict-offline load that refuses the network when the model is absent.
