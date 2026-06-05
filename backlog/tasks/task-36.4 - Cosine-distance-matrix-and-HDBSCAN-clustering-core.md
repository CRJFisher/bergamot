---
id: TASK-36.4
title: Cosine distance matrix and HDBSCAN clustering core
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.1
  - TASK-36.3
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
  - /Users/chuck/workspace/clustering-js/backlog/docs/tdt-upgrade-plan.md
parent_task_id: TASK-36
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The clustering core — the only stage that calls clustering-tfjs. Build the dense precomputed cosine distance matrix from the page vectors (clamp to non-negative, force the diagonal to zero, symmetrize), run HDBSCAN fit-only, enforce the page-count ceiling, and lock determinism.

Parameters are decoupled and configurable (not magic constants): minClusterSize and minSamples are independent, eom selection (with stored exemplars), a swept clusterSelectionEpsilon. HDBSCAN emits labels* (-1 = noise), probabilities*, and exemplarIndices\_.

EXTERNAL DEPENDENCY: requires the clustering-tfjs HDBSCAN upgrade (its Phases 0, 2, 3): an HDBSCAN estimator accepting metric='precomputed' and emitting labels*/probabilities*/exemplarIndices\_, plus select_medoids. Planned in the clustering-tfjs repo (backlog/docs/tdt-upgrade-plan.md, tasks 49–55). This subtask is blocked until that ships.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §6 (The clustering pipeline).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 build_cosine_distance_matrix produces a dense (n,n) matrix with zero diagonal, symmetric, clamped to [0,2]
- [ ] #2 HDBSCAN runs with metric='precomputed', decoupled minClusterSize/minSamples, eom selection and stored exemplars, emitting labels* (with -1), probabilities*, and exemplarIndices\_
- [ ] #3 The page-count guard rejects an oversized window before the dense matrix is allocated
- [ ] #4 With a pinned tfjs backend, a bitwise reproducibility test shows the same window clustered twice yields identical labels* and probabilities*
- [ ] #5 The clustering-tfjs version and backend are recorded for the run's algo_version
- [ ] #6 Integration tests over fixture windows pass, and fail clearly with a descriptive message when the HDBSCAN dependency is absent
<!-- AC:END -->
