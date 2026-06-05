---
id: TASK-36.1
title: "Scaffold @bergamot/tdt package: ports, config, types, fakes"
status: To Do
assignee: []
created_date: "2026-06-05 19:22"
labels: []
dependencies: []
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Create the @bergamot/tdt workspace skeleton and the dependency-injection seams every later subtask builds on. The module is a pure library with NO imports from vscode/src; the extension supplies concrete port implementations.

Define the injected port contracts (RelationalReader for DuckDB visit reads, EmbedFn for TDT's own local text embedding, VectorStore for the page-vector cache, ClusterSink for writes), default config, shared stage types, and in-memory fakes for each port. Quarantine the clustering-tfjs camelCase↔snake_case naming translation inside this package boundary.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §3 (Architecture / module boundary).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A new tdt/ workspace is added to the root package.json workspaces array and tsc builds it clean
- [ ] #2 ports.ts defines RelationalReader, EmbedFn, VectorStore, and ClusterSink with documented contracts, and contains no import from vscode/src
- [ ] #3 In-memory fakes exist for every port and a no-op run_tdt(deps, args) round-trips them in a unit test
- [ ] #4 config.ts exposes DEFAULT_WINDOW_CONFIG and DEFAULT_HDBSCAN_CONFIG and types.ts defines the shared stage types
- [ ] #5 A package README documents the module boundary and the dependency-injection contracts
<!-- AC:END -->
