---
id: task-14.1
title: Implement webpage storage optimization - remove DuckDB duplication
status: To Do
assignee: []
created_date: '2025-08-07 16:07'
labels: []
dependencies: []
parent_task_id: task-14
---

## Description

Implement the storage optimization plan identified in task 14 by removing webpage content duplication between DuckDB and LanceDB. Keep content only in LanceDB vector store which already supports key-based lookups, reducing storage by 45-50% and improving write performance.

## Acceptance Criteria

- [ ] Remove webpage_content table from DuckDB schema
- [ ] Remove all insert_webpage_content() function calls
- [ ] Update get_webpage_content() to fetch from LanceDB
- [ ] Update all content retrieval queries to use LanceDB
- [ ] Ensure backward compatibility for existing data
- [ ] All tests pass
- [ ] Storage reduction verified
