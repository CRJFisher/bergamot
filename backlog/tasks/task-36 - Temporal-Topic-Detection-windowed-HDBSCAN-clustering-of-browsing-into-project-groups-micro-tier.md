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
