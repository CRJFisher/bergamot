---
id: TASK-35.11
title: >-
  IA remodel: rename modules, dissolve WebpageWorkflow into functions, rename
  the seam
status: To Do
assignee: []
created_date: '2026-06-04 17:33'
updated_date: '2026-06-04 18:02'
labels: []
dependencies:
  - TASK-35.9
  - TASK-35.4
  - TASK-35.5
references:
  - vscode/src/workflow/simple_workflow.ts
  - vscode/src/workflow/webpage_filter.ts
  - vscode/src/reconcile_webpage_trees_workflow_models.ts
parent_task_id: TASK-35
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mechanical rename-only PR (lands last). simple_workflow.ts -> page_ingest_pipeline.ts; dissolve class WebpageWorkflow into run_page_ingest(deps: IngestDeps, inputs) (deps is an immutable struct; no stateful class — required by the no-stateful-classes rule) with named stage functions extract_essence.ts / summarize_essence.ts / store_essence.ts / link_tree.ts. Update ALL constructors/callers of the old class, not just the queue seam: reconcile_webpage_trees_workflow_vanilla.ts (the build_workflow() factory — delete it and call run_page_ingest directly, or rename it build_ingest_deps), server/server_manager.ts (the `webpage_categoriser_app!: WebpageWorkflow` field, the build_workflow call, and the ctor arg passed to the queue processor), and visit_queue_processor.ts (the webpage_categoriser_app field/call site). webpage_filter.ts -> page_gate.ts (the GateDecision {keep, reason} type is introduced by task-35.8; here only the FILE + residual symbols are renamed). html_reduce.ts -> html_prepass.ts (or inline into extract_essence). reconcile_webpage_trees_workflow_models.ts -> page_essence_models.ts. Rename matching .test.ts files (colocated). No aliases or re-exports anywhere. Keep the diff rename-only (no behavior change) for reviewability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 simple_workflow.ts renamed page_ingest_pipeline.ts; WebpageWorkflow dissolved into run_page_ingest with named stage modules; no stateful class remains
- [ ] #2 webpage_filter.ts -> page_gate.ts (GateDecision type already introduced by task-35.8 — this PR renames only the file + residual symbols), html_reduce.ts -> html_prepass.ts, reconcile_webpage_trees_workflow_models.ts -> page_essence_models.ts
- [ ] #3 All old-class callers updated: reconcile_webpage_trees_workflow_vanilla.ts (build_workflow factory) and server/server_manager.ts (webpage_categoriser_app field, build_workflow call, ctor arg) and visit_queue_processor.ts; no symbol named WebpageWorkflow or webpage_categoriser_app remains
- [ ] #4 All test files renamed/colocated and passing; no aliases or re-exports left behind
- [ ] #5 Diff is rename-only (no behavior change) for reviewability
<!-- AC:END -->
