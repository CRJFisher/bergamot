---
id: TASK-36.7
title: Validation harness and parameter sweep
status: Done
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-23 03:45"
labels: []
dependencies:
  - TASK-36.4
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make parameter choice evidence-based — it is the load-bearing quality risk. Build a deterministic harness that sweeps window length, minClusterSize, minSamples, and clusterSelectionEpsilon over real windows and scores results by HDBSCAN-native validity (cluster persistence / mean membership probability) plus noise fraction, excluding noise (-1) from scoring. Note: the shipped clustering-tfjs silhouette is Euclidean-only and noise-naive, so it is NOT the coherence gate.

The harness also runs the raw-dimension vs PCA-50 A/B, confirms a known project recovers as a cluster (rather than dissolving into noise), and defines a noise-rate/hubness guardrail whose PCA-promotion path is exercised. The chosen operating point is persisted as config (a data change, not a code change), parameterized by window size.

Beyond per-window scores, the harness reports two cross-window summaries that gate downstream decisions. First, **cross-window variance** — the variance of per-window N, cluster count, and noise fraction — which is the evidence gate for activating the target-N windowing seam (plan §5); state the lever order explicitly: `minClusterSize`-as-a-fraction-of-N (plan §6) is the FIRST lever, target-N re-windowing the heavier SECOND, only if the first is insufficient. Second, a **boundary-fragmentation metric** — the count of clusters whose time span touches a window boundary — so "how bad is fragmentation actually" is measured before the tracker / SOM slices are prioritised. The harness additionally records the **trigger-cadence evidence** task-36.9 consumes: the live visits-per-month distribution and the measured per-run re-download volume (new public pages absent from `topic_page_vector`), which together justify the automatic-trigger cadence default.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §6 (high-dimensional geometry, determinism) and §10 (validation-metric caveat); cadence consumer in task-36.9.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 A deterministic harness runs the parameter grid over real windows and reports cluster count, noise fraction, and HDBSCAN-native validity (cluster persistence / mean probability), excluding -1 from scoring
- [x] #2 The raw-dimension vs PCA-50 A/B is run and recorded, and a known project is confirmed to recover as a cluster
- [x] #3 A noise-rate / hubness guardrail is defined and its PCA-promotion path is exercised
- [x] #4 The chosen operating point is persisted as config, parameterized by window size, rather than hardcoded
- [x] #5 The harness reports cross-window variance (per-window N, cluster count, noise fraction) and a boundary-fragmentation count (clusters whose time span touches a window edge), and records the visits-per-month distribution plus per-run re-download volume that justify the task-36.9 trigger cadence
<!-- AC:END -->

## Implementation Notes

### High-level summary

Parameter choice is the load-bearing quality risk for the TDT micro tier: a `minClusterSize` / `minSamples` / `epsilon` that fits a busy month over-merges a quiet one, and high-dimensional over-noising looks identical to working-as-intended on a dashboard while silently destroying recall. This slice makes that choice **evidence-based** rather than asserted. It adds a deterministic harness that sweeps the parameter grid over real windows, scores each cell by the one honest signal HDBSCAN produces fit-only, and selects an operating point that is persisted as config data — so re-tuning as history grows is a data edit, not a code change.

The harness lives in [tdt/src/validation/](../../tdt/src/validation/) and operates on **already-resolved page vectors** (`WindowInput` = parallel `visits[]` / `vectors[]`), keeping it a pure, deterministic compute consistent with the package's dependency-injected architecture: the batch orchestrator (task-36.9) resolves vectors through the real ports first, then hands them here. It splits along the package's tf boundary — [scoring.ts](../../tdt/src/validation/scoring.ts) and [operating_point.ts](../../tdt/src/validation/operating_point.ts) are tf-free and on the `index.ts` barrel; [sweep.ts](../../tdt/src/validation/sweep.ts) imports `clustering-tfjs` (PCA) and reuses the clustering core, so it stays off the barrel exactly like `cluster_window.ts` / `representations.ts`, and the orchestrator imports `run_sweep` from it directly.

The **coherence signal is mean per-cluster membership probability over non-noise points**, NOT silhouette and NOT cluster persistence. This is the honest consequence of plan §10 verified against the library: `clustering-tfjs` 0.6.1 exposes no `cluster_persistence_` attribute, and its shipped `silhouette` is Euclidean-only and noise-naive — it is not the coherence gate. Every score excludes label `-1`. The harness runs the **raw-dimension vs deterministic PCA-50 A/B** (`reduce_pca50` reduces, L2-renormalizes so the precomputed-cosine path stays valid, and clusters through the same core), confirms a **known project recovers as one cluster** rather than dissolving into noise, and defines the **noise-rate / hubness guardrail** whose PCA-promotion path it exercises. Beyond per-cell scores it reports the two cross-window summaries that gate downstream decisions — **cross-window variance** (the evidence gate for the windowing seam; `minClusterSize`-as-a-fraction-of-N is the first lever, target-N re-windowing the heavier second) and a **boundary-fragmentation count** — plus the **visits-per-month distribution** and **per-run re-download volume** that justify the task-36.9 trigger cadence. `summarize_validation` rolls these four AC#5 signals up into one report.

The chosen operating point is persisted to [operating_point.json](../../tdt/operating_point.json) at the package root, keyed by window unit, so it is parameterized by window size and re-tuning is a data change. `config.ts` keeps the grid's starting defaults (the search space); `select_operating_point` writes the chosen point. There is no live capture DuckDB in the build environment, so the file is seeded with the design-default starting point (`minClusterSize=3`, `minSamples=5`, `eom`, `epsilon=0`, `raw`); the harness rewrites it when run against live windows.

To navigate: start at `run_sweep` in `sweep.ts` (the entry point), read `score_cell` in `scoring.ts` for the validity math, then `select_operating_point` in `operating_point.ts` for how the point is chosen and persisted.

### Decisions

- **HDBSCAN-native validity = mean membership probability, not silhouette/persistence.** Verified against the library: 0.6.1 has no `cluster_persistence_` and a Euclidean-only, noise-naive silhouette. The harness gates on the fit-only signal that actually exists (mean of `probabilities_` over non-noise points), returns `null` — never `0` — when a window has no clusters so an all-noise cell can never out-rank a real-but-weak one, and excludes `-1` everywhere. The honesty is documented in `scoring.ts` and the README so a reader does not mistake it for silhouette.
- **The harness operates on resolved page vectors, not raw data.** It is a pure compute over `WindowInput`; vector resolution through the ports is the orchestrator's job. This keeps it deterministic and unit-testable on fixtures, and keeps the tf/tf-free split clean.
- **Determinism by construction.** The grid enumerates in a fixed order; HDBSCAN is bitwise-deterministic per tf backend; PCA's power iteration — the only randomness in the stack — takes an explicit `random_state`; and the operating point's `selected_at` is injected, never `Date.now()`. The persisted point is a cache key, so order-independent selection (a total tie-break comparator) is load-bearing.
- **PCA-50, not PCA-5, and L2-renormalized.** Low-dim PCA collapses HDBSCAN to noise (plan §6, GDELT). `n_components = min(50, n−1, dim)` caps to the window's rank, a window of ≤1 page is a no-op, and reduced rows are L2-renormalized (a degenerate centroid row falls back to a basis vector, never an un-normalizable zero) because the precomputed-cosine path assumes unit vectors.
- **Operating point is config data parameterized by window size.** A JSON file at the package root, not hardcoded params, keyed by window unit, validated on load (domain, not just type — a stale or hand-edited out-of-range value fails loud rather than silently mis-clustering a later run). `config.ts` holds the search space; the JSON holds the chosen point.
- **Guardrail anchored to the real ship default.** `evaluate_guardrail` trips on the default-params raw cell — derived from `DEFAULT_HDBSCAN_CONFIG`, not bare literals, so it cannot drift from the actual default — when noise persistently exceeds the band OR the typical cluster size collapses toward `minClusterSize`. "Exercised" (AC#3) means the PCA-promotion path runs and is asserted, not that synthetic PCA must beat raw; `pca_improves` records the verdict either way (the A/B adopts raw only if it wins or ties).

### Verification

`@bergamot/tdt`: 226 unit tests pass (1 todo), both `tsc` configs clean. New coverage across three colocated suites: the scoring math (noise fraction, mean-over-non-noise excluding `-1`, median odd/even, population variance, the half-open-window boundary-fragmentation predicate, visits-per-month bucketing, the `summarize_validation` rollup, re-download volume) with the empty / all-noise / single-page edge cases; the sweep (108-cell grid order, PCA reduction unit-norm + determinism + tiny-window no-op, raw and PCA paths, two-run bitwise determinism, known-project recovery and its dissolved-into-noise negative, both guardrail trip reasons — noise-persistent and median-size-collapse — and the exercised PCA-promotion path); and the operating point (healthy-band selection, the known-project hard gate, deterministic order-independent tie-breaks, the fail-loud no-healthy-cell case, serialize/parse round-trip, and domain validation rejecting out-of-range params). The seeded `operating_point.json` loads and matches the design default for `month` and `14d`. The harness composes the existing `cluster_window` / `represent_clusters` stages unchanged; no production path is touched.
