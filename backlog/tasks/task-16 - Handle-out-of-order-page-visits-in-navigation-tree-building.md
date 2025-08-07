---
id: task-16
title: Handle out-of-order page visits in navigation tree building
status: To Do
assignee: []
created_date: '2025-08-07 08:57'
labels:
  - vscode
  - navigation
  - critical
dependencies: []
---

## Description

When tabs are opened via links or window.open(), the child tab often sends its visit BEFORE the parent tab. This creates orphaned pages that arrive at the server with an opener_tab_id that doesn't exist yet. The VS Code extension needs to handle this race condition when building navigation trees.

## Acceptance Criteria

- [ ] VS Code extension temporarily stores orphaned pages (visits with unmatched opener_tab_id)
- [ ] When parent page arrives later check for orphaned children and reconnect them
- [ ] Update or re-insert child pages to maintain proper tree structure
- [ ] Reconcile group_id if parent and child have different group_ids
- [ ] Navigation trees correctly reflect parent-child relationships regardless of arrival order
- [ ] Add tests for out-of-order page visit scenarios
