---
id: task-18.2
title: Remove dead code and unused dependencies
status: In Progress
assignee: []
created_date: '2025-08-07 20:40'
updated_date: '2025-08-08 12:07'
labels: []
dependencies: []
parent_task_id: task-18
---

## Description

Identify and remove all unused code, functions, imports, and npm dependencies to reduce bundle size and improve maintainability

## Acceptance Criteria

- [ ] All unused imports removed
- [ ] All unused functions/classes removed
- [ ] All unused npm dependencies removed from package.json
- [ ] All commented-out code blocks removed
- [ ] Bundle size reduced by at least 10%

## Implementation Notes

Partially completed:
- Removed 4 skipped tests that would never pass due to DuckDB limitations
  - 1 test in webpage_tree.test.ts (UPDATE with foreign keys limitation)
  - 2 tests in simple_workflow.test.ts (feature tests not applicable)
  - 1 concurrent modification test (DuckDB prepared statement limitation)
- These tests were dead code as they were permanently skipped
- Still need to audit for other unused imports, functions, and dependencies
