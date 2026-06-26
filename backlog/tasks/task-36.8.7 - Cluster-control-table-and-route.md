---
id: TASK-36.8.7
title: Cluster-control table + write route (launch-blocking)
status: Done
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.8.1
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The launch-blocking control surface (constitution §3: "the control surface is what converts
'surveilled' into 'seen'"): suppress / rename / never-cluster-this-origin, written to
Bergamot's OWN `topic_cluster_control` table in the encrypted metadata store — NOT the PKM,
so principle 8 does not gate it. Suppress/rename persist across recomputes by anchoring on
the cluster's exemplar page plus a content signature (the per-run cluster id dangles);
never-cluster-origin keys on a registrable domain and feeds the skip-re-download list. The
read primitive applies suppress/rename in-memory. Right-to-forget sweeps the page-anchored
controls; never-cluster-origin survives. Exposed via `POST /cluster_control` and
`POST /cluster_control/delete`, consumed by the skill so it works on every host.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 `topic_cluster_control` table + store with idempotent upsert/list/delete and a resolve helper
- [x] #2 Suppress/rename key on the stable exemplar + signature; never-cluster-origin on the registrable domain
- [x] #3 `POST /cluster_control` (+ `/delete`) resolving the live cluster id to its stable anchor; origin normalized via tldts
- [x] #4 Forget cascade sweeps suppress/rename by page id; never-cluster-origin survives; covered by tests

<!-- AC:END -->

## Implementation Notes

### High-level summary

`vscode/src/tdt/cluster_control_store.ts` owns the table access, the deterministic
`control_id`, and `compute_content_signature`. The table is created in
`create_metadata_schema` (`duck_db.ts`). `cluster_reads.ts` applies the resolved controls;
`get_cluster_anchor` resolves an ephemeral cluster id to the stable anchor for the route.
Routes in `server_manager.ts` (`handle_cluster_control`). `right_to_forget.ts` sweeps
suppress/rename (`cluster_controls_deleted`) and deliberately keeps never-cluster-origin.
The input-filter consumer (`list_never_cluster_origins`) is exposed for the skip-re-download
and clustering-input seams, which the orchestration adapter (TASK-36.9) wires in. Tested in
`cluster_control_store.test.ts`, `cluster_routes.test.ts`, and `right_to_forget.test.ts`.
