---
id: TASK-44.6
title: "tdt library: colocate types.ts and config.ts with their functional modules"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - tdt
dependencies: []
references:
  - tdt/src/types.ts
  - tdt/src/config.ts
  - tdt/src/index.ts
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`tdt/src/types.ts` is a 10-DTO grab-bag imported by every module in the library, and `tdt/src/config.ts` bundles three orthogonal config domains. The library's layering is otherwise clean (leaf → mid-tier → tf-tier, acyclic); this is purely a colocation fix.

**Scope**

Distribute each type and its defaults to the module that owns the concept:

- `HdbscanRaw` + `HdbscanConfig` (with defaults) → `cluster_window.ts`
- `RepresentedCluster` → `representations.ts`
- `RunRecord` / `ClusterRecord` / `MemberRecord` → `persist.ts`
- `ClusterLabel` → `labeling/deterministic_labeler.ts`
- `WindowConfig` (with defaults) → `windowing.ts`
- `PageVectorConfig` (with defaults) → `page_vectors.ts`
- `DistanceMatrix` → `cluster_window.ts` (its producer)

`types.ts` shrinks to the genuinely shared primitives of the read path (`VisitRow`, `PageContent`, `PageRepr`, `PageVector`, `RunBundle`); `config.ts` is deleted. `index.ts` remains the single public barrel — it is the package API, not a shim — updated to export from the new locations. `ports.ts` and `run_keying.ts` are untouched. Host code (`vscode/src/tdt`) imports via the barrel and `out/cluster_pipeline`, so it should need no changes beyond recompilation; verify `cluster_worker.ts`'s direct `out/cluster_pipeline` import still resolves.

Renames via `git mv` where files move; colocated tests updated; no aliases or transitional re-exports outside the public barrel.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 types.ts holds only shared read-path primitives (~40 lines); config.ts is deleted
- [ ] #2 Every clustering/persistence/labeling/windowing type and default lives in its functional module
- [ ] #3 The public barrel exports are unchanged in surface (host code compiles without edits)
- [ ] #4 All tdt tests pass; tsc and lint clean

<!-- AC:END -->
