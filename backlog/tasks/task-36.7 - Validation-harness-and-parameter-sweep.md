---
id: TASK-36.7
title: Validation harness and parameter sweep
status: To Do
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

- [ ] #1 A deterministic harness runs the parameter grid over real windows and reports cluster count, noise fraction, and HDBSCAN-native validity (cluster persistence / mean probability), excluding -1 from scoring
- [ ] #2 The raw-dimension vs PCA-50 A/B is run and recorded, and a known project is confirmed to recover as a cluster
- [ ] #3 A noise-rate / hubness guardrail is defined and its PCA-promotion path is exercised
- [ ] #4 The chosen operating point is persisted as config, parameterized by window size, rather than hardcoded
- [ ] #5 The harness reports cross-window variance (per-window N, cluster count, noise fraction) and a boundary-fragmentation count (clusters whose time span touches a window edge), and records the visits-per-month distribution plus per-run re-download volume that justify the task-36.9 trigger cadence
<!-- AC:END -->
