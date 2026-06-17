---
id: TASK-36.9
title: Trigger and off-thread orchestration
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.4
  - TASK-36.6
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Wire the end-to-end run behind a manual VS Code command, keeping the heavy compute off the extension-host event loop so a multi-second clustering run never freezes the UI or stalls the /visit capture endpoint. The command invokes a pure rebuild_clusters(window_spec) module function; embedding and HDBSCAN compute run in a worker thread or child process (mirroring the existing MCP-server spawn pattern); the worker returns raw results and the extension's single DuckDB writer persists them in one short transaction. No scheduler (YAGNI) — that is purely additive later.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §11 step 9.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A bergamot.tdt.rebuildClusters command invokes a pure rebuild_clusters(window_spec) function
- [ ] #2 Embedding and HDBSCAN compute run off the extension-host event loop (worker thread or child process), and the /visit capture endpoint plus the UI stay responsive during a run
- [ ] #3 Results are persisted by the extension's single DuckDB writer in one short transaction
- [ ] #4 An end-to-end test or documented manual verification clusters a real month and browses the result via the MCP surface without blocking capture
<!-- AC:END -->
