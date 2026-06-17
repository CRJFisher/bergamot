---
id: TASK-36.1
title: "Scaffold @bergamot/tdt package: ports, config, types, fakes"
status: Done
assignee: []
created_date: "2026-06-05 19:22"
labels: []
dependencies: []
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


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
- [x] #1 A new tdt/ workspace is added to the root package.json workspaces array and tsc builds it clean
- [x] #2 ports.ts defines RelationalReader, EmbedFn, VectorStore, and ClusterSink with documented contracts, and contains no import from vscode/src
- [x] #3 In-memory fakes exist for every port and a no-op run_tdt(deps, args) round-trips them in a unit test
- [x] #4 config.ts exposes DEFAULT_WINDOW_CONFIG and DEFAULT_HDBSCAN_CONFIG and types.ts defines the shared stage types
- [x] #5 A package README documents the module boundary and the dependency-injection contracts
<!-- AC:END -->

## Implementation Notes

## High-level summary

`@bergamot/tdt` is the dependency-injection seam that every later TDT subtask builds on. It exists so the clustering logic can be a pure, testable library with no vscode or DuckDB imports — all I/O arrives through four injected port contracts that the extension supplies concrete implementations of.

The approach is a flat module structure with two import-free leaf modules (`types.ts`, `config.ts`) at the base. `ports.ts` depends on `types.ts` for the port method signatures; `index.ts` depends on both and is the package's single public surface. This acyclic graph means each subtask (windowing, vectorisation, clustering, persistence) adds a new file that imports from the leaves and is imported by `index.ts` — no circular dependencies are possible by construction.

The four major moving parts: `types.ts` holds the eight stage data types (VisitRow → HdbscanRaw → RepresentedCluster, plus the three persistence record types) as an import-free leaf. `config.ts` holds WindowConfig + HdbscanConfig with their defaults. `ports.ts` defines the four injectable contracts — RelationalReader (visit reads via the extension's DuckDB broker), EmbedFn (callable type alias for local embedding), VectorStore (page-vector cache), ClusterSink (three-method write path). `index.ts` re-exports everything and defines `TdtDeps`/`TdtArgs`/`run_tdt`. In-memory fakes in `src/fakes/` implement all four contracts against plain JS Maps and arrays.

Start reading at `src/index.ts`, which is the front door. The canonical design document is `backlog/drafts/tdt-hdbscan-micro-tier-plan.md`; all `plan §N` citations in the code refer to its sections.

The camelCase↔snake_case translation for the `clustering-tfjs` library output (`labels_`/`probabilities_`/`exemplarIndices_`) is NOT in ports.ts — it is quarantined at the single `fit()` call site in `cluster_window.ts` (lands in a later subtask). `HdbscanRaw` in `types.ts` is the snake_case target of that translation.

Review fixes applied: `RunRecord.cluster_count`/`noise_count` made `number | null` to match the nullable DDL columns (a `running` row exists before counts are computed); `TdtDeps.vector_store` renamed to snake_case; test colocated to `src/index.test.ts`; lint script updated to cover test files.
