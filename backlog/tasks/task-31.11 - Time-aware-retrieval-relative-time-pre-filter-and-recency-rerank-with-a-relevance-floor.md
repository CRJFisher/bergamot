---
id: TASK-31.11
title: >-
  Time-aware retrieval: relative-time pre-filter and recency rerank with a
  relevance floor
status: To Do
assignee: []
created_date: "2026-06-05 11:38"
labels: []
dependencies:
  - TASK-31.1
  - TASK-31.2
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make time a first-class retrieval signal on top of the hybrid dense+BM25 pipeline, so queries with time intent ("what was I reading last month about X", "the latest thing I saw on Y") work without recency drowning relevance. This exploits the per-visit timestamps Bergamot already stores as capture metadata (`page_loaded_at`, `captured_at`) and the existing index on `page_loaded_at` — no schema change. Time filtering and reranking apply only to retrievable pages: metadata-only visits (auth-walled / failed re-download, excluded from the corpus) carry a timestamp but have no vector and so do not appear in semantic results. Two query-time, infra-free mechanisms: (1) detect time intent and, for explicit/relative expressions, anchor them to a reference "now" and apply a hard timestamp pre-filter (a `WHERE` on the visit-time range, in DuckDB and/or a LanceDB `where()` clause) before semantic ranking; (2) an optional recency rerank that blends cosine with an exponential half-life decay on page age — `score = alpha*cos + (1-alpha)*0.5^(age_days/half_life)` (alpha and half_life configurable, default alpha ~0.7) — gated behind a raw-cosine relevance floor so a fresh-but-off-topic page cannot be boosted. Apply time weighting conditionally on detected intent, never as a fixed global decay (both over-weighting recency and ignoring it fail to retrieve correctly, per Grofsky 2025). Expose a `time_range` parameter on the `semantic_search` MCP tool. This is the cheap, proven half of the user's "find time+topic clusters over time" goal; the speculative clustering half (temporal topic clustering / TDT) is recorded as deferred in task-31.9. Frame the work as "time-aware retrieval", not "Temporal Cluster RAG" (which is not an established technique). See backlog/docs/rag-pipeline-upgrade-plan.md (Phase I).

**Learning companion:** [backlog/docs/rag-explainers/10-time-aware-retrieval.html](10-time-aware-retrieval.html) — interactive explainer of the concepts and the decision logic for this phase.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 semantic_search accepts an optional time_range and applies it as a pre-filter on the visit timestamp (page_loaded_at) before semantic ranking
- [ ] #2 Relative-time expressions ("last month", "recently") are anchored to a reference now and converted to a concrete timestamp range
- [ ] #3 An optional recency rerank blends cosine with an exponential half-life decay on page age, with alpha and half-life configurable, exposed as a time_reranked toggle on the semantic_search MCP tool alongside time_range
- [ ] #4 A raw-cosine relevance floor gates the recency boost so fresh-but-off-topic pages are not surfaced
- [ ] #5 Time weighting is applied conditionally on detected time intent, not as a fixed global decay
- [ ] #6 On the task-31.1 eval harness, time-intent queries improve vs the hybrid baseline with no regression on non-temporal queries
  <!-- AC:END -->
  </content>
  </invoke>
