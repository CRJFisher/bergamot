---
id: TASK-35.2
title: >-
  Remove tree_intentions: delete the tree-intentions step, table, and sonnet
  call
status: To Do
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
- [ ] #1 Step 5, TREE_INTENTIONS_PROMPT, the webpage_tree_intentions table/index/insert/interface, and both LEFT JOIN ti clauses (~759, ~956) are removed
- [ ] #2 tree_intentions field and TreeIntentions type are removed from the models; webpage_tree_to_md_string intentions branches removed
- [ ] #3 get_navigation_tree / list_recent_navigation_trees return valid trees (url, title, content, summary) with tree_intentions absent (test asserts this)
- [ ] #4 No remaining caller of the 'smart' role exists; the smart key is retained in the model map for type completeness but is NOT exposed as a user setting (see task-35.6)
- [ ] #5 Dev-DB reset procedure used per task-35.3 (no ALTER); MCP tree-JSON field removal documented as a contract change
<!-- AC:END -->
