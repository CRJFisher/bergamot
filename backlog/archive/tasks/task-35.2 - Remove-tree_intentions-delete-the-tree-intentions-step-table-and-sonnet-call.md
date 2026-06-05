---
id: TASK-35.2
title: >-
  Remove tree_intentions: delete the tree-intentions step, table, and sonnet
  call
status: Done
assignee: []
created_date: '2026-06-04 17:31'
updated_date: '2026-06-04 18:02'
labels: []
dependencies:
  - TASK-35.3
references:
  - vscode/src/workflow/simple_workflow.ts
  - vscode/src/workflow/prompts.ts
  - vscode/src/duck_db.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Delete workflow step 5 (the only 'smart'/sonnet call), TREE_INTENTIONS_PROMPT, the webpage_tree_intentions table + idx_tree_intentions_composite + insert_webpage_tree_intentions + WebpageTreeIntention interface + the LEFT JOIN ti in both tree queries (duck_db.ts ~759, ~956), and the tree_intentions field from PageActivitySessionWithMetaSchema + the TreeIntentions type. Remove the webpage_tree_to_md_string intentions branches. This must precede per-page intentions removal because per-page intentions are an input to this step. Navigation tree construction (referrer_page_session_id / tree_id) is untouched. Use a destructive dev-DB reset, not an ALTER.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Step 5, TREE_INTENTIONS_PROMPT, the webpage_tree_intentions table/index/insert/interface, and both LEFT JOIN ti clauses (~759, ~956) are removed
- [x] #2 tree_intentions field and TreeIntentions type are removed from the models; webpage_tree_to_md_string intentions branches removed
- [x] #3 get_navigation_tree / list_recent_navigation_trees return valid trees (url, title, content, summary) with tree_intentions absent (test asserts this)
- [x] #4 No remaining caller of the 'smart' role exists; the smart key is retained in the model map for type completeness but is NOT exposed as a user setting (see task-31.10)
- [x] #5 Dev-DB reset procedure used per task-35.3 (no ALTER); MCP tree-JSON field removal documented as a contract change
<!-- AC:END -->


## Implementation Notes

Removed the tree-intentions step (the only `smart`/sonnet call) and all its storage.

- **Workflow** (`workflow/simple_workflow.ts`): deleted step-5b tree-intentions block, the `webpage_tree_to_md_string` helper, and the now-unused `get_tree_with_id` / `WebpageTreeNode` imports. No caller of the `smart` role remains.
- **Prompt** (`workflow/prompts.ts`): deleted `TREE_INTENTIONS_PROMPT`.
- **Schema/DB** (`duck_db.ts`): removed `WEBPAGE_TREE_INTENTIONS_TABLE` constant, its `CREATE TABLE`, `idx_tree_intentions_composite`, `insert_webpage_tree_intentions`, the `WebpageTreeIntention` interface, the `LEFT JOIN ti` + `ti.intentions as tree_intentions` selects in both tree queries, and the `tree_intentions` mapping in `row_to_page_activity_session_with_meta`. Schema change applied via dev-DB reset (task-35.3), no ALTER.
- **Models** (`reconcile_webpage_trees_workflow_models.ts`): removed the `tree_intentions` field from `PageActivitySessionWithMetaSchema` and deleted `TreeIntentionsSchema`/`TreeIntentions`.
- **Fake client** (`workflow/fake_llm_client.ts`): dropped the `page_id_to_intentions` field from the canned JSON.
- **Tests**: removed tree-intentions assertions/setup from `duck_db.test.ts`, `webpage_tree.test.ts`, `simple_workflow.test.ts`; updated the "all tables" assertion to `webpage_capture`. `get_page_sessions_with_tree_id` / `get_last_modified_trees_with_members_and_analysis` still return valid trees (url, title, content, summary) with `tree_intentions` absent.

The `smart` key is retained in the per-provider model maps for type completeness (`ModelRole`) but has no live caller and is not user-exposed (see task-31.10).

**MCP contract change:** navigation-tree JSON returned via the `/query/tree` and `/query/recent_trees` endpoints (and the MCP tools that surface them) no longer carries a `tree_intentions` field. Documented in the architecture docs update.

Files: `workflow/simple_workflow.ts`, `workflow/prompts.ts`, `duck_db.ts`, `reconcile_webpage_trees_workflow_models.ts`, `workflow/fake_llm_client.ts`, `duck_db.test.ts`, `webpage_tree.test.ts`, `workflow/simple_workflow.test.ts`.
