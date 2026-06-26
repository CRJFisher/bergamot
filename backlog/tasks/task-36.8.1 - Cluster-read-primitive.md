---
id: TASK-36.8.1
title: Cluster read primitive (cluster_reads.ts)
status: Done
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.5
  - TASK-36.6
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The single, host-agnostic read API over the cluster + 36.5 label-bundle tables — the
only surface-facing code that JOINs `topic_run` × `topic_cluster` × `topic_cluster_member`
(+ `webpage_*` for page url/title/time). Four pure `(db, params) → JSON` functions, each
filtered to the live (`status='complete'`) run and clamped by `MAX_QUERY_LIMIT`:
`list_clusters_in_range`, `get_cluster`, `list_clusters_for_page` (with a three-way
`page_status ∈ {clustered, noise, unseen}`), `window_coverage`. Returns plain JSON (no
MCP/HTTP/VS Code types). `scope` is surfaced verbatim; `representative_vector` is never
selected. User curation (suppress/rename) is applied in-memory against the page-keyed
control store. Lives at `vscode/src/tdt/cluster_reads.ts`, mirroring the write-side
`cluster_store.ts`.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 Four functions filtered to the live run, returning JSON-serializable shapes drawn from the 36.5 fields, with `representative_vector` excluded
- [x] #2 `list_clusters_for_page` distinguishes clustered / processed-noise / unseen
- [x] #3 Suppress/rename controls applied so no consumer sees an un-curated cluster
- [x] #4 Colocated `cluster_reads.test.ts` covering range overlap edges, superseded-run exclusion, the three page states, and control application

<!-- AC:END -->

## Implementation Notes

### High-level summary

`vscode/src/tdt/cluster_reads.ts` is the read backbone of the TDT surface. It is the only
module that JOINs the cluster tables; every other surface consumes its JSON. Counts are
coerced from `bigint`, `keyphrases` from `DuckDBListValue` to `string[]` (empty → `[]`),
and controls are resolved once per call from `cluster_control_store` and applied in-memory
so the SQL still touches only the cluster tables. `get_cluster_anchor` translates a live
cluster id into the stable curation anchor for the control route. Tested in
`cluster_reads.test.ts`.
