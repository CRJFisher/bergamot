---
id: TASK-36.3
title: "Page vectorisation: TDT-owned embedding of re-downloaded pages"
status: Done
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

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Build the one-vector-per-page step that makes TDT independent of the RAG pipeline. This is where the "no task-31 dependency" property is realized: the embedding INPUT is RE-DOWNLOADED PUBLIC content, not captured/stored HTML (capture records metadata only). TDT reads the re-downloaded page (via the task-39.2 fetcher / content read path) plus its parsed <head> metadata, builds a deterministic page-level text (title + lead / main-content extract), embeds it with TDT's OWN injected local model, L2-normalizes, and caches the result. Visits with no re-downloadable public content (auth-walled / paywalled / dead) yield no vector and are excluded. Pages over the embedder's token budget are split into segments, embedded, and mean-pooled (a throwaway internal split — NOT RAG chunking; no contextual prefixes, no persisted chunks).

Correctness guards ship here: multi-topic dispersion → represent by dominant segment; degenerate near-zero vector → fallback; pages with no extractable text → excluded. Determinism is anchored by fixed-order float64 accumulation when pooling segments.

Concrete interface (task-39.2, shipped): consume `ContentCorpus` in `vscode/src/redownload/corpus.ts` — `iter_public_pages()` yields only the re-downloadable public subset (one `CorpusContent` per `ok` page, with `content` + parsed `<meta>`), and `get_content(page_session_id)` reads a single page. Excluded visits (auth/paywall/dead/non-HTML) are simply not emitted, which realizes the "no vector for non-public visits" exclusion above.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §4 (Data inputs & the page-vector problem).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 build_page_vector consumes already-extracted public-page content (a PageContent projection of CorpusContent, via the task-39.2 read path) and returns one L2-normalized vector via the injected EmbedFn, with no dependency on RAG chunk vectors or LanceDB
- [x] #2 Page vectors are cached in topic_page_vector keyed by (page_session_id, embedding_model_id), where embedding_model_id encodes model + dim + representation-rule version; a model or representation change yields a new key (cache miss), invalidating the prior entry
- [x] #3 Guards are implemented: multi-topic dispersion falls back to the dominant (medoid) segment, a degenerate near-zero vector falls back, and no-text pages are excluded
- [x] #4 A determinism test shows the same extracted content plus a pinned model yields a bitwise-identical page vector regardless of processing order
- [x] #5 Repeat same-URL visits within a navigation tree are deduped before clustering
- [x] #6 Unit tests cover the guards, caching/invalidation, and determinism
<!-- AC:END -->

## Implementation Notes

### High-level summary

Page vectorisation is the step that makes TDT independent of the RAG pipeline: it turns one re-downloaded public page into one L2-normalized vector that clustering consumes. It lives in the pure `@bergamot/tdt` library as `tdt/src/page_vectors.ts`, which depends only on injected ports — no RAG chunk vectors, no LanceDB, and no fetching of its own.

`build_page_vector` is a pure transform from `(PageContent, repr, config)` plus an injected `EmbedFn` to a single page vector. It builds a deterministic page-level text (title + lead, or title + full main-content), splits it into code-point segments under a character budget that proxies the embedder's token budget, embeds each segment in order, and mean-pools them with fixed-order float64 accumulation before a single L2-normalization. Three correctness guards protect the downstream cosine matrix: a multi-topic page (segments with low mean pairwise cosine) is represented by its dominant medoid segment rather than a mean that lands in dead space between sub-topics; a pooled vector that collapses below ε falls back to the medoid; and a page with no extractable text — or one that is truly degenerate after fallback — is excluded (returns `null`, never a zero vector). Determinism is exact: NFC + whitespace normalization, code-point-offset slicing, in-order embedding, fixed-order accumulation, and exactly one float32 truncation mean the same content and pinned model yield byte-identical bytes regardless of processing order.

`resolve_page_vector` wraps the builder in the `VectorStore` cache: a hit returns the stored vector without embedding; a miss builds, persists, and returns it. The representation-rule version is folded into `embedding_model_id`, so a model or representation change is a clean cache miss. `dedupe_visits` collapses repeat same-URL visits within one navigation tree to a single clustering unit (kept in input order, which the sorted-input contract makes the earliest), while keeping the same URL in different trees.

The concrete `VectorStore` implementation, the `run_tdt` orchestration loop that maps `CorpusContent → PageContent` and drives dedupe → resolve → cluster, and the right-to-forget cascade entry for the vector store all land in later TASK-36 subtasks; this task ships the pure library, fakes, and tests.

### Decisions

- **TDT consumes already-extracted content; it does not re-download.** The original task framing had `build_page_vector` re-download the public URL and parse its HTML. Pages are now re-downloaded eagerly per visit and cached upstream (the task-39.2 content read path / encrypted content cache), so TDT consumes a `PageContent` projection of `CorpusContent` (title + main-content markdown) and performs no fetching, no HTML parsing, and no fetch-outcome classification — auth-walled / paywalled / dead / non-HTML pages are excluded upstream and never reach this code.
- **Page vectors stay in the encrypted DuckDB store; LanceDB was evaluated and rejected.** A vector DB (LanceDB) was considered to serve both the K-V cache and downstream similarity search. It was rejected because it cannot be encrypted at rest while remaining searchable, and content-derived vectors are sensitive — storing them in plaintext violates the privacy constitution. DuckDB already serves vector similarity search via built-in `array_cosine_similarity` / `array_distance` over fixed-size `FLOAT[dim]` columns, so the encrypted store satisfies the downstream goal with no new dependency, no second concurrency model, and a trivial right-to-forget cascade.
- **Similarity search is deferred to RAG (task-31).** TDT's clustering uses a precomputed dense cosine distance matrix, not nearest-neighbor search, so the page-vector cache needs only get/put now. The `array_cosine_similarity` query path (and the optional `vss`/HNSW index) lands with RAG, the first similarity-search consumer, which shares this same encrypted DuckDB vector store and embedding space.
