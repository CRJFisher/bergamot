---
id: TASK-36
title: >-
  Temporal Topic Detection: windowed HDBSCAN clustering of browsing into project
  groups (micro tier)
status: To Do
assignee: []
created_date: '2026-06-05 19:22'
updated_date: '2026-06-10 07:47'
labels: []
dependencies:
  - TASK-39.2
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
  - backlog/drafts/tdt-temporal-topic-architecture.md
priority: medium
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the first, most-important slice of the Temporal Topic Detection & Tracking (TDT) subsystem: an offline, modular module that clusters the user's timestamped browsing into coherent "projects" / "research threads" — groups of highly-related pages — using windowed HDBSCAN over page-embedding cosine similarity, and rejects one-off pages as noise.

TDT operates over the RE-DOWNLOADED PUBLIC corpus, not captured content: capture stores browsing metadata only (never page content), and page content comes from re-downloading the stored public URLs during post-processing (the fetcher, task-39.2). TDT is the FIRST content consumer in the pipeline — it runs ahead of the RAG pipeline (task-31). Visits whose pages fail to re-download (auth-walled / paywalled / dead links) remain as trail/metadata only and are EXCLUDED from clustering; the login wall is the privacy filter.

This subsystem is INDEPENDENT of the RAG pipeline (task-31). It reads the re-downloaded public content (via the task-39.2 fetcher / content read path) for visits in a time window, EMBEDS IT ITSELF with its own local model (it does not consume RAG's chunk vectors and does not wait on task-31), clusters per time window, persists its own cluster tables, and exposes a new read-only MCP surface. The only nominal overlap with RAG is "both embed text" — that is not a shared dependency. (Aligning TDT's embedding model with RAG's later, to enable cross-feature work like grouping search hits by project, is a deferred config option, not a build dependency.)

It lives in a new top-level npm workspace package `@bergamot/tdt` (sibling of vscode/ and browser/): a pure dependency-injected library plus thin adapters, depending only on injected port contracts and the `clustering-tfjs` library.

Full design and the build order this task series implements: backlog/drafts/tdt-hdbscan-micro-tier-plan.md. Broader two-tier vision (macro SOM tier, cross-window tracking, LLM linkage — all LATER slices): backlog/drafts/tdt-temporal-topic-architecture.md.

EXTERNAL DEPENDENCY: the clustering subtask requires the clustering-tfjs HDBSCAN upgrade (its Phases 0, 2, 3 — an HDBSCAN estimator with metric='precomputed' emitting labels*/probabilities*/exemplarIndices\_, plus select_medoids). That work is planned in the separate clustering-tfjs repo (its backlog/docs/tdt-upgrade-plan.md, tasks 49–55) and is a prerequisite for the clustering subtask.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new @bergamot/tdt workspace package clusters a real time window of re-downloaded public pages into project groups end-to-end, browsable via the MCP surface, without blocking capture; auth-walled / failed-re-download visits are excluded from clustering (trail/metadata only)
- [ ] #2 TDT embeds pages with its own model and has no build-time or runtime dependency on the RAG pipeline (task-31)
- [ ] #3 Clustering is deterministic and reproducible — same captures plus a pinned model produce identical clusters, verified by a regression test
- [ ] #4 One-off pages are surfaced as noise rather than forced into clusters, and per-window cluster coverage / noise rate is queryable
- [ ] #5 Operating parameters are selected by a validation sweep on real data and persisted as config rather than hardcoded
- [ ] #6 backlog/drafts/tdt-hdbscan-micro-tier-plan.md remains the canonical reference and stays in sync with what ships
- [ ] #7 Every cluster/persistence store this task introduces joins the right-to-forget cascade in vscode/src/right_to_forget.ts (constitution principle 4), with the cascade tests extended to cover it
<!-- AC:END -->

## Cross-cutting review (2026-06-27, subtasks 36.1–36.9; 36.10 deferred)

A deep multi-lens review (correctness of the pure core, vscode orchestration,
privacy/constitution, MCP+skill surface, test quality) over the whole subsystem,
with every finding adversarially verified. Baseline before fixes: pure `@bergamot/tdt`
228 tests, vscode `src/tdt` 140 tests, all green. After fixes: pure 231, vscode +
routes + forget 192, full `tsc` clean.

### Applied

- **Windowing degenerated on near-uniform browsing (correctness, HIGH).** Under
  near-uniform inter-visit spacing the gap-split peeled one visit at a time off the
  earliest equal-largest gap, shedding most of a dense window as sub-min-visit skips
  and growing recursion depth to O(n). Fixed in `tdt/src/windowing.ts`: a gap split
  must clear a balance floor (`GAP_SPLIT_MIN_SHARE`) to count as progress — a
  non-dominant gap now falls through to calendar bisection — and a terminal
  median-by-count bisection guarantees the `max_samples` count guard is honoured even
  for uniform data with no calendar boundary. Regression tests added (uniform
  overflow stays clustered; genuine multi-burst still gap-splits).
- **Cluster rename dropped from the staged note stub (surface, HIGH).** A user
  rename overwrote `display_label`, but the stub heading preferred `headline_title`,
  so the hero-loop note never showed the rename. Added an explicit `renamed_label`
  signal on `ClusterSummary` (`cluster_reads.apply_rename`); the stub heading/summary
  honour it while the filename/lineage stays anchored on the rename-independent
  original label (no duplicate file on rename).
- **Forgotten page survived in retained cluster aggregates (privacy, MED).** The
  cascade deleted a forgotten page's `topic_page_vector` and `topic_cluster_member`
  rows but left `topic_cluster.representative_vector` (the member-mean embedding) and
  exemplar — the forgotten contribution baked into the aggregate — for superseded
  runs and out-of-range windows that never re-key. `right_to_forget.ts` now dissolves
  every cluster a forgotten page contributed to (deletes the `topic_cluster` row and
  its member rows across all runs); report gains `clusters_dissolved`.
- **Production ignored the sweep-selected operating point (AC#5, MED).** The only
  production `RebuildDeps` assembly used `DEFAULT_HDBSCAN_CONFIG`, never loading
  `operating_point.json`. New `vscode/src/tdt/operating_config.ts` resolves the tuned
  point by window unit (fails loud on a `pca50` point the raw production path can't
  apply); wired into `server_manager.ts`. Test asserts the resolved config reflects
  the data file.
- **Leading-zero page vectors were silently corrupted to noise (correctness,
  discovered while strengthening the integration test).** `PageVectorStore.put` bound
  the vector as an untyped list, so DuckDB inferred `INTEGER[]` from an integer-valued
  leading component (e.g. a vector starting at `0.0`) and truncated every fractional
  component to 0. `DuckDB.execute` gained an explicit per-param `types` argument and
  the store now binds `LIST(FLOAT)`. Regression test added for a leading-zero /
  leading-integer vector.
- **Test-coverage gaps.** Worker spawn-error and crash-without-reply paths
  (`cluster_worker_client.test.ts`); the end-to-end sweep → `select_operating_point`
  selection path producing a grid-resident, round-trippable entry
  (`operating_point.test.ts`); and the integration test now asserts the two seeded
  topics actually separate (members drawn from exactly one topic, full coverage, zero
  noise) rather than only counting clusters — which is what exposed the vector bug.

### Declined

- **Redundant per-page `vector_store.get` in the embed pass (efficiency, LOW).** One
  extra indexed point lookup per page on the cache-hit path, purely to classify the
  report as skipped vs embedded. Off the capture hot path, correctness unaffected, and
  documented as intentional — left as-is per YAGNI.
