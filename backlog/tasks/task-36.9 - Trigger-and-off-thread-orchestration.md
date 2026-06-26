---
id: TASK-36.9
title: Trigger and off-thread orchestration
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-23 03:45"
labels: []
dependencies:
  - TASK-36.4
  - TASK-36.6
  - TASK-36.7
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Wire the end-to-end run behind two entry surfaces over one pure rebuild_clusters(window_spec) module function: a manual VS Code command (on-demand and for testing) and an automatic scheduled trigger (the passive-product path — Bergamot surfaces projects without the user remembering to run anything). Keep the heavy compute off the extension-host event loop so a multi-second clustering run never freezes the UI or stalls the /visit capture endpoint: both the network re-download and the O(n^2) HDBSCAN fit run in a worker thread or child process (mirroring the existing MCP-server spawn pattern); the worker returns raw results and the extension's single DuckDB writer persists them in one short transaction.

The automatic trigger is an in-host scheduler (a VS Code extension timer / activation-time check), not an OS cron + headless writer — a headless writer would violate the single-writer model (plan §3). The cadence is configurable; its default is an evidence-based judgement made from task-36.7's output (the live visits-per-month distribution and the measured per-run re-download volume), defaulting to once/day until that data narrows it. A single-flight guard prevents duplicate concurrent runs across multiple workspace windows and reloads. Cost on quiet days is bounded by §8 idempotency: a run over an unchanged window (same input_fingerprint) is a no-op, so a daily tick that finds no new visits costs ~nothing. Count-based triggers ("fire after N visits") are out of scope — the count guard is a windowing quality invariant (task-36.2), not a trigger — as is OS cron.

This orchestration adapter also owns two input-path hooks left by TASK-36.8: it adds the
`GET /query/visits_in_window?from=&to=` Stage-1 bulk read that feeds clustering (preserved in
plan §9, not yet in server_manager.ts), and it applies the user's `never-cluster-origin`
preferences — read via `ClusterControlStore.list_never_cluster_origins()` — to exclude those
registrable domains from the clustering input (and from the skip-re-download list), satisfying
constitution §3's "never-cluster-this-origin feeds the capture/skip-re-download list."

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §11 step 9; cadence evidence from task-36.7; cost model in plan §8; the §8.8 control hooks from TASK-36.8 (backlog/decisions/0001-tdt-cluster-surface.md).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A bergamot.tdt.rebuildClusters command invokes a pure rebuild_clusters(window_spec) function
- [ ] #2 Both the re-download (network) and the HDBSCAN fit (CPU) run off the extension-host event loop (worker thread or child process), and the /visit capture endpoint plus the UI stay responsive during a run
- [ ] #3 Results are persisted by the extension's single DuckDB writer in one short transaction
- [ ] #4 An end-to-end test or documented manual verification clusters a real month and browses the result via the MCP surface without blocking capture
- [ ] #5 An automatic in-host trigger fires rebuild_clusters on a configurable cadence (default once/day, the value justified by the task-36.7 evidence), with a single-flight guard that prevents duplicate concurrent runs across windows and reloads
- [ ] #6 A scheduled run over an unchanged window performs no re-download and no re-fit (the §8 idempotency no-op), verified by a test
- [ ] #7 The `GET /query/visits_in_window?from=&to=` Stage-1 bulk read (plan §9) is added, row-capped to a full window, feeding the clustering input
- [ ] #8 `never-cluster-origin` controls (TASK-36.8) exclude their registrable domains from the clustering input and the skip-re-download list, via `list_never_cluster_origins()`
<!-- AC:END -->
