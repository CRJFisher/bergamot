---
id: TASK-36.4
title: Cosine distance matrix and HDBSCAN clustering core
status: Done
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.1
  - TASK-36.3
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
  - /Users/chuck/workspace/clustering-js/backlog/docs/tdt-upgrade-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The clustering core — the only stage that calls clustering-tfjs. Build the dense precomputed cosine distance matrix from the page vectors (clamp to non-negative, force the diagonal to zero, symmetrize), run HDBSCAN fit-only, enforce the page-count ceiling, and lock determinism.

Parameters are decoupled and configurable (not magic constants): minClusterSize and minSamples are independent, eom selection (with stored exemplars), a swept clusterSelectionEpsilon. HDBSCAN emits labels* (-1 = noise), probabilities*, and exemplarIndices\_.

EXTERNAL DEPENDENCY: requires the clustering-tfjs HDBSCAN upgrade (its Phases 0, 2, 3): an HDBSCAN estimator accepting metric='precomputed' and emitting labels*/probabilities*/exemplarIndices\_, plus select_medoids. Planned in the clustering-tfjs repo (backlog/docs/tdt-upgrade-plan.md, tasks 49–55). This subtask is blocked until that ships.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §6 (The clustering pipeline).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 build_cosine_distance_matrix produces a dense (n,n) matrix with zero diagonal, symmetric, clamped to [0,2]
- [x] #2 HDBSCAN runs with metric='precomputed', decoupled minClusterSize/minSamples, eom selection and stored exemplars, emitting labels* (with -1), probabilities*, and exemplarIndices\_
- [x] #3 The page-count guard rejects an oversized window before the dense matrix is allocated
- [x] #4 With a pinned tfjs backend, a bitwise reproducibility test shows the same window clustered twice yields identical labels* and probabilities*
- [x] #5 The clustering-tfjs version and backend are recorded for the run's algo_version
- [x] #6 Integration tests over fixture windows pass, and fail clearly with a descriptive message when the HDBSCAN dependency is absent
<!-- AC:END -->

## Implementation Notes

### High-level summary

The clustering core is the one stage that calls `clustering-tfjs`, and it lands as [cluster_window.ts](../../tdt/src/cluster_window.ts) in the pure `@bergamot/tdt` library. It takes the L2-normalized page vectors a window resolves to and produces an in-memory `HdbscanRaw` (`labels`, `probabilities`, `exemplar_indices`); representation, labeling, persistence, and the extension trigger are later subtasks.

`build_cosine_distance_matrix` builds the dense `(n,n)` matrix HDBSCAN consumes with `metric: 'precomputed'`. Because the vectors are already L2-normalized, cosine similarity is the dot product and the distance is `clamp(1 − dot, 0, 2)`; the diagonal is forced to exactly 0 and the matrix is symmetric by construction. The page-count guard rejects an oversized window (`n > max_samples`) before the `O(n²)` matrix is allocated, and a one-time dimension-uniformity check rejects a ragged window before the dot loop can silently read past an array end.

`cluster_window` is the single `fit()` call site (the camelCase-free `clustering-tfjs` API is quarantined here): it constructs `HDBSCAN` with decoupled `min_cluster_size` / `min_samples`, `eom` selection, and `store_exemplars`, then translates the fitted `labels_` / `probabilities_` / `exemplar_indices_` into `HdbscanRaw`. An empty window short-circuits to an empty result rather than tripping the library's zero-row rejection.

`resolve_algo_version` records the reproducibility identity `hdbscan-1#clustering-tfjs@<version>#<backend>` (e.g. `hdbscan-1#clustering-tfjs@0.6.1#tensorflow`) — the library version read from its installed manifest and the active TensorFlow backend read from the shared `tfjs-core` registry.

### Decisions

- **`clustering-tfjs` 0.6.1 runs HDBSCAN on a TensorFlow.js backend.** Its core-distance (`tf.topk`) and mutual-reachability (`tf.maximum`) steps run in a fused `tf.tidy`, so a backend is required at runtime; results are bitwise-deterministic for a given backend. Determinism is "pinned" by installing exactly one backend — the library's auto-probe order (`tfjs-node-gpu → tfjs-node → tfjs → tfjs-core`) is itself a pure function of which package is present — and the chosen backend is folded into `algo_version`. Measured ~11× speedup of the native backend over pure-JS CPU (122 ms vs 1379 ms at n=1500, d=384), which is why the dependency was bumped from 0.6.0.
- **The distance matrix is built in float64 by TDT, not via the library's `pairwise_distance_matrix`.** Cosine is not a native HDBSCAN metric, so `precomputed` is the only cosine path regardless; building `D` ourselves keeps the accumulation in float64 (the library re-tensors it to float32 internally, still deterministic) and avoids a second tf code path.
- **The native backend lives only in the `vscode` host, never in `tdt`.** `tdt` is a pure, environment-agnostic library, so it depends only on `clustering-tfjs` and the pure-JS `@tensorflow/tfjs-core` (used solely to read the active backend name). The native `@tensorflow/tfjs-node` backend is declared by `vscode` (guaranteed Node); `tdt`'s tests pick it up via workspace hoisting.
- **`cluster_window` is NOT re-exported from the `@bergamot/tdt` barrel.** Its `clustering-tfjs` import pulls the native TensorFlow chain, and the barrel is bundled into the extension by esbuild (via the embed pass's value import), so re-exporting it broke the production bundle with node-pre-gyp resolution errors. The orchestrator (TASK-36.9) imports the stage directly and owns externalising the native deps into the VSIX; exposing it on the barrel now would ship the TensorFlow stack for code not yet called.
- **Dependency-absent failures are reframed (AC#6).** `require_hdbscan` gives a TDT-framed error if the export is missing, and `reframe_clustering_error` catches both backend-absent strings the library surfaces — `"No TensorFlow.js backend available"` (no `@tensorflow/*` resolves at all) and `"No backend found in registry"` (the string actually hit when `tfjs-core` resolves but no compute backend is installed) — pointing the host at `@tensorflow/tfjs-node`.

### Verification

71 `@bergamot/tdt` unit tests pass, including: the distance-matrix shape/zero-diagonal/symmetry/clamp invariants and the identical/orthogonal/opposite 0/1/2 mapping; the page-count guard and the dimension-uniformity guard; a real-library `fit` producing ≥2 clusters with honest `-1` noise, `[0,1]` probabilities (0 for noise), and one exemplar per cluster; a bitwise-reproducibility test asserting identical `labels`, `probabilities`, and `exemplar_indices` across two fits; `algo_version` recording the version and the active backend; and both dependency-absence guards. The `vscode` production bundle (`scripts/bundle.mjs`) and the externals guard (`scripts/check-bundle-externals.mjs`) both pass, confirming no TensorFlow chain leaks into the bundle.
