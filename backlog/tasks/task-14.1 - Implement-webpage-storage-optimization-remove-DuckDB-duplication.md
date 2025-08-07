---
id: task-14.1
title: Implement webpage storage optimization - remove DuckDB duplication
status: In Progress
assignee:
  - '@claude'
created_date: '2025-08-07 16:07'
updated_date: '2025-08-07 16:30'
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

## Implementation Plan

1. Remove webpage_content table creation from DuckDB schema\n2. Remove insert_webpage_content() function and all calls\n3. Update get_webpage_content() to fetch from LanceDB memory store\n4. Update get_all_pages_for_rag() to use LanceDB\n5. Update get_page_by_title() to use LanceDB\n6. Update row_to_page_activity_session_with_meta() to fetch from LanceDB\n7. Test all affected functionality\n8. Verify storage reduction
