---
id: TASK-36.8.2
title: Cluster query routes + retire the raw-tool scope
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

Bind the read primitive to four loopback routes mirroring the existing `/query/*` pattern
(param validation → 400, `MAX_QUERY_LIMIT` clamp, `res.json`): `GET /query/clusters`,
`/query/cluster`, `/query/clusters_for_page`, `/query/cluster_coverage`. Explicitly NOT
`/query/topic_*` and NO MCP `ListTools`/`CallTool` cases — the raw-tool surface is retired.
Rewrite plan §9 to describe the integration primitive and delete its retired three-tool
spec, while **preserving** the separate `GET /query/visits_in_window` Stage-1 bulk-read
requirement (it feeds clustering, is not a user surface, and belongs to TASK-36.9).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 Four `/query/cluster*` read routes over the primitive, mirroring existing route conventions
- [x] #2 No `/query/topic_*` routes and no new MCP tool cases (the raw-tool scope is retired)
- [x] #3 Plan §9 rewritten to the primitive + consumers; the `visits_in_window` Stage-1 read explicitly preserved as orchestration work
- [x] #4 Route tests covering happy path, 400 on missing params, and null/unknown

<!-- AC:END -->

## Implementation Notes

### High-level summary

Routes added to `vscode/src/server/server_manager.ts`, delegating to the read primitive;
covered by `vscode/src/server/cluster_routes.test.ts` (supertest over the real in-memory
DuckDB). Plan §9 (`backlog/drafts/tdt-hdbscan-micro-tier-plan.md`) rewritten: the raw
three-tool/`/query/topic_*` spec is deleted, the integration primitive and its consumers
are described, and the `visits_in_window` Stage-1 bulk read is preserved as a distinct,
still-required deliverable on the clustering input path.
