---
id: TASK-44.7
title: "vscode/src/tdt: evict non-domain infra; substructure the flat folder by sub-function"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - vscode
  - tdt
dependencies: []
references:
  - vscode/src/tdt/util_node24_compat.ts
  - vscode/src/tdt/single_flight.ts
  - vscode/src/tdt/cluster_worker.ts
  - vscode/src/tdt/cluster_scheduler.ts
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Two files in the tdt domain folder are not tdt functionality, and the folder itself is 19 flat files mixing five sub-functions.

**Scope**

1. **`util_node24_compat.ts`** — verboten `util_` prefix. It is a tfjs-in-child-worker compat shim (patches `util.isNullOrUndefined` for Node 24) whose only importer is `cluster_worker.ts`. Its functional home is beside that worker under a name that says what it is — e.g. `cluster_worker_node24_tfjs_compat.ts` — or folded into the worker's bootstrap if the side-effect-import ordering allows.
2. **`single_flight.ts`** — a generic concurrency latch with no TDT binding. Colocate it with its consumer (the scheduler / orchestration wiring). Do **not** promote it to a `util/` or `shared/` folder — that recreates the disease with a new name. If TASK-44.5 later gives it a second consumer inside tdt orchestration, it stays where the orchestration lives.
3. **Substructure the folder by its five sub-functions**, names describing the feature, not the code class:
   - embedding pass: `embed_pass.ts`, `local_embedder.ts`, `embedding_config.ts`, `page_vector_store.ts`
   - worker compute: `cluster_worker.ts`, `cluster_worker_client.ts` (+ the compat shim)
   - cluster store/surface: `cluster_store.ts`, `cluster_reads.ts`, `cluster_control_store.ts`, `visit_reads.ts`
   - rebuild orchestration: `rebuild_clusters.ts`, `cluster_scheduler.ts` (+ `single_flight`)
   - note staging: `note_stub.ts`, `staging_writer.ts`, `staging_root.ts`
     `operating_config.ts` stays at the tdt root (it bridges the library's operating-point JSON to host config). Avoid folder names like `persistence/` or `orchestration/` if a more feature-specific name reads better; the executor may keep the folder flat for a group of ≤2 files rather than invent a folder.

Update importers (`server_manager.ts`, `right_to_forget.ts`, `commands/`, `extension.ts`). Renames via `git mv`; colocated tests and `__fixtures__` move; no aliases or re-exports.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 No file in vscode/src/tdt carries a util_ prefix; the Node-24 shim is named for its function and lives beside cluster_worker
- [ ] #2 single_flight lives with its consumer, not in a generic utility location
- [ ] #3 The folder is grouped by the five sub-functions with feature-named subfolders (or justified flat groups); no class-of-code folder names introduced
- [ ] #4 All tests pass including rebuild_clusters.integration.test.ts; tsc and lint clean; diff is rename-only

<!-- AC:END -->
