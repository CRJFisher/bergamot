---
id: TASK-36.7
title: Validation harness and parameter sweep
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.4
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make parameter choice evidence-based — it is the load-bearing quality risk. Build a deterministic harness that sweeps window length, minClusterSize, minSamples, and clusterSelectionEpsilon over real windows and scores results by HDBSCAN-native validity (cluster persistence / mean membership probability) plus noise fraction, excluding noise (-1) from scoring. Note: the shipped clustering-tfjs silhouette is Euclidean-only and noise-naive, so it is NOT the coherence gate.

The harness also runs the raw-dimension vs PCA-50 A/B, confirms a known project recovers as a cluster (rather than dissolving into noise), and defines a noise-rate/hubness guardrail whose PCA-promotion path is exercised. The chosen operating point is persisted as config (a data change, not a code change), parameterized by window size.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §6 (high-dimensional geometry, determinism) and §10 (validation-metric caveat).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A deterministic harness runs the parameter grid over real windows and reports cluster count, noise fraction, and HDBSCAN-native validity (cluster persistence / mean probability), excluding -1 from scoring
- [ ] #2 The raw-dimension vs PCA-50 A/B is run and recorded, and a known project is confirmed to recover as a cluster
- [ ] #3 A noise-rate / hubness guardrail is defined and its PCA-promotion path is exercised
- [ ] #4 The chosen operating point is persisted as config, parameterized by window size, rather than hardcoded
<!-- AC:END -->
