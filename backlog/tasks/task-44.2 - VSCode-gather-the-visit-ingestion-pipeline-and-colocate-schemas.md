---
id: TASK-44.2
title: "VSCode: gather the visit-ingestion pipeline into visit/; colocate the *_models.ts schemas"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - vscode
dependencies: []
references:
  - vscode/src/visit_inbox.ts
  - vscode/src/visit_queue_processor.ts
  - vscode/src/visit_replay.ts
  - vscode/src/orphaned_visits.ts
  - vscode/src/webpage_tree.ts
  - vscode/src/workflow/page_capture_pipeline.ts
  - vscode/src/duck_db_models.ts
  - vscode/src/page_capture_models.ts
  - vscode/src/webpage_tree_models.ts
  - vscode/src/hash_utils.ts
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The visit-ingestion pipeline (durable inbox → batch queue → orphan parking → tree linking → capture insert) is one coherent functionality scattered as loose top-level files, with its final stage alone in a `workflow/` folder that exists for a single 44-line file. Separately, three top-level `*_models.ts` files form a schema layer divorced from the logic that reads and writes those schemas, chained to each other by imports (`page_capture_models` imports from `duck_db_models`; `webpage_tree_models` imports from `page_capture_models`).

**Scope**

1. Create `vscode/src/visit/` holding the pipeline: `visit_inbox.ts`, `visit_queue_processor.ts`, `visit_replay.ts`, `orphaned_visits.ts`, `webpage_tree.ts`, and `page_capture_pipeline.ts` (dissolving `workflow/`). Drop now-redundant `visit_` prefixes where the folder carries the meaning (`visit/inbox.ts`, `visit/queue_processor.ts`, `visit/replay.ts`).
2. Colocate each schema with its owning module — no top-level models layer remains:
   - `PageActivitySession` schemas (`duck_db_models.ts`) move into `duck_db/` beside their readers/writers (`session_reads.ts` / `session_writes.ts`).
   - `PageCapture` / `WebpageFetch` schemas (`page_capture_models.ts`) move beside `duck_db/capture.ts`, their primary reader/writer.
   - `WebpageTreeNode` (`webpage_tree_models.ts`, 23 lines) merges into `visit/webpage_tree.ts`.
     The executor decides exact file granularity; the principle is that a schema lives in the functional module that owns the data, and no file exists whose only identity is "models".
3. Inline `hash_utils.ts` (10 lines, single `md5_hash`) into `webpage_tree.ts`, its only consumer; the MD5→hex identity is load-bearing for stable tree ids, so preserve it byte-for-byte and keep its test.

Update all importers (server_manager, right_to_forget, commands, redownload, tdt readers). Renames via `git mv`; colocated tests move with their code; no aliases or re-exports.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 vscode/src/visit/ contains the six pipeline modules; workflow/ is gone; no visit-pipeline file remains loose at the top level
- [ ] #2 No *_models.ts file exists at vscode/src top level; each schema lives in the functional module that owns its data
- [ ] #3 hash_utils.ts is gone; tree-id hashing lives in webpage_tree with its behavior and test preserved
- [ ] #4 All vscode tests pass; tsc and lint clean; diff is rename + mechanical wiring only

<!-- AC:END -->
