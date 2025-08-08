---
id: task-18.6
title: Refactor complex functions for clarity
status: In Progress
assignee: []
created_date: "2025-08-07 20:40"
updated_date: "2025-08-08 12:07"
labels: []
dependencies: []
parent_task_id: task-18
---

## Description

Identify and refactor functions with high cyclomatic complexity (>10) to improve readability and maintainability

## Acceptance Criteria

- [ ] All functions with complexity >10 identified
- [ ] Complex functions broken down into smaller units
- [ ] Helper functions extracted where appropriate
- [ ] Function responsibilities clearly defined (single responsibility)
- [ ] All refactored code maintains existing functionality
- [ ] Code comments added where complexity cannot be avoided

## Implementation Notes

Partially completed during test fixes:

- Refactored DuckDB.query method to properly use runAndReadAll for correct results
- Simplified procedural_memory_store SQL operations by converting from parameterized queries to direct SQL (avoiding DuckDB ANY type issues)
- Fixed complex root node detection logic in webpage_tree.get_tree_with_id
- Added proper BigInt to number conversions in get_rule_statistics
- Still need to identify and refactor other complex functions with high cyclomatic complexity
