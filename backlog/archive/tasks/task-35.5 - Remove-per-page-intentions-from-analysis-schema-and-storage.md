---
id: TASK-35.5
title: 'Remove per-page intentions from analysis, schema, and storage'
status: Done
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
- [x] #1 intentions removed from ANALYSIS_PROMPT, PageAnalysisSchema, the webpage_analysis schema/insert/row-mapping, and both tree-query analysis_intentions selects
- [x] #2 The misspelled TS/Zod key page_sesssion_id is corrected to page_session_id in PageAnalysisSchema and at every property-read site (reconcile_webpage_trees_workflow_models.ts, duck_db.ts insert/row-mapping ~482/495/524, simple_workflow.ts ~225); the DuckDB column is already correctly named page_session_id and needs no change
- [x] #3 No intentions assertions remain in tests; all affected tests pass
- [x] #4 Dev-DB reset used (references task-35.3); no ALTER/backfill
<!-- AC:END -->


## Implementation Notes

Removed per-page intentions everywhere and corrected the long-standing misspelled key.

- **Prompt** (`workflow/prompts.ts`): `ANALYSIS_PROMPT` now asks only for title + summary; the intentions instruction and JSON field are gone.
- **Schema** (`reconcile_webpage_trees_workflow_models.ts`): dropped `intentions` from `PageAnalysisSchema`; `PageAnalysis` is now `{page_session_id, title, summary}`. Fixed `page_sesssion_id` → `page_session_id` (and in the `.omit(...)` for `PageAnalysisSchemaWithoutPageSessionId`).
- **DB** (`duck_db.ts`): removed the `intentions` column from the `webpage_analysis` `CREATE TABLE`, from `insert_webpage_analysis`, from `map_row_to_page_analysis`, and the `a.intentions as analysis_intentions` select in both tree queries; removed the `intentions` field from the analysis object in `row_to_page_activity_session_with_meta`. Every `analysis.page_sesssion_id` read now uses `page_session_id`. The DuckDB column was already correctly named `page_session_id`, so the schema change is column-removal only (dev-DB reset, task-35.3 — no ALTER).
- **Workflow** (`workflow/simple_workflow.ts`): `analysis_with_id` now uses `page_session_id`.
- **Fake client** (`workflow/fake_llm_client.ts`): dropped the dead `intentions` field.
- **Tests**: removed all per-page `intentions` assertions/fixtures and renamed the typo key across `duck_db.test.ts`, `webpage_tree.test.ts`, `simple_workflow.test.ts`. Full suite green (243 tests).

Files: `workflow/prompts.ts`, `reconcile_webpage_trees_workflow_models.ts`, `duck_db.ts`, `workflow/simple_workflow.ts`, `workflow/fake_llm_client.ts`, `duck_db.test.ts`, `webpage_tree.test.ts`, `workflow/simple_workflow.test.ts`.
