---
id: TASK-35.5
title: 'Remove per-page intentions from analysis, schema, and storage'
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-04 18:01'
labels: []
dependencies:
  - TASK-35.2
references:
  - vscode/src/workflow/prompts.ts
  - vscode/src/reconcile_webpage_trees_workflow_models.ts
  - vscode/src/duck_db.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drop the intentions output from ANALYSIS_PROMPT, the intentions field from PageAnalysisSchema, the intentions column from webpage_analysis (CREATE TABLE definition only, dev-DB reset), the intentions handling in insert_webpage_analysis and row mapping, and the analysis_intentions selects in both tree queries. Fix the misspelled key page_sesssion_id -> page_session_id atomically with the SQL/Zod change. This lands after tree_intentions removal (task-35.2) so the tree-intentions input is already gone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 intentions removed from ANALYSIS_PROMPT, PageAnalysisSchema, the webpage_analysis schema/insert/row-mapping, and both tree-query analysis_intentions selects
- [ ] #2 The misspelled TS/Zod key page_sesssion_id is corrected to page_session_id in PageAnalysisSchema and at every property-read site (reconcile_webpage_trees_workflow_models.ts, duck_db.ts insert/row-mapping ~482/495/524, simple_workflow.ts ~225); the DuckDB column is already correctly named page_session_id and needs no change
- [ ] #3 No intentions assertions remain in tests; all affected tests pass
- [ ] #4 Dev-DB reset used (references task-35.3); no ALTER/backfill
<!-- AC:END -->
