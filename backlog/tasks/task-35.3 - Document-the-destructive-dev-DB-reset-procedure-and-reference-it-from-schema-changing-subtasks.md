---
id: TASK-35.3
title: >-
  Document the destructive dev-DB reset procedure and reference it from
  schema-changing subtasks
status: To Do
assignee: []
created_date: "2026-06-04 17:31"
labels: []
dependencies: []
parent_task_id: TASK-35
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

There is no DuckDB migration framework (CREATE TABLE IF NOT EXISTS, no schema_version, no ALTER path) and LanceDB drops + recreates only on embedding-dimension mismatch — adding fields to webpage_content does NOT auto-drop. Per the no-backwards-compat constitution and pre-release dev data, document a single dev-step that wipes the DuckDB file and the LanceDB directory so first run recreates the new shape (including the webpage_content record reshape, which is dimension-unchanged and would otherwise drift). Reference this procedure from every schema-changing subtask as its migration step.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A documented single-step procedure wipes the DuckDB file and LanceDB directory; first run recreates the new schema
- [ ] #2 Procedure explicitly recreates the LanceDB webpage_content table so reshaped essence fields take effect (dimension-unchanged, no auto-drop)
- [ ] #3 All schema-changing subtasks reference this procedure as their migration step; no ALTER/backfill is written anywhere
<!-- AC:END -->
