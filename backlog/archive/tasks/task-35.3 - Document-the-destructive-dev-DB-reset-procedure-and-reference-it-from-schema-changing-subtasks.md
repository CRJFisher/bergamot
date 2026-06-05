---
id: TASK-35.3
title: >-
  Document the destructive dev-DB reset procedure and reference it from
  schema-changing subtasks
status: Done
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

- [x] #1 A documented single-step procedure wipes the DuckDB file and LanceDB directory; first run recreates the new schema
- [x] #2 Procedure explicitly recreates the LanceDB webpage_content table so reshaped essence fields take effect (dimension-unchanged, no auto-drop)
- [x] #3 All schema-changing subtasks reference this procedure as their migration step; no ALTER/backfill is written anywhere
<!-- AC:END -->

## Implementation Notes

Created `backlog/docs/dev-db-reset.md` documenting the single-step destructive reset: stop the Extension Development Host, then `rm -rf .dev-storage/webpage_categorizations.db .dev-storage/webpage_memory.db` (or `rm -rf .dev-storage` to also clear the inbox/dev log). First F5 run recreates both stores in the current shape.

Key facts captured: no DuckDB migration framework (`CREATE TABLE IF NOT EXISTS`, no `schema_version`); LanceDB only auto-drops `webpage_content` on embedding-dimension mismatch (`database_manager.ts` → `drop_table_if_vector_dim_mismatch`), so a dimension-unchanged reshape needs a manual wipe. Stores resolve under `get_storage_base` (`config/storage_path.ts`): DuckDB `webpage_categorizations.db`, LanceDB `webpage_memory.db/`, inbox `visit_inbox/`; dev uses repo-local `.dev-storage` via `BERGAMOT_STORAGE_PATH`.

Schema-changing subtasks (35.1, 35.2, 35.5, 35.9) reference this doc as their migration step; no ALTER/backfill code is written anywhere.

Files: `backlog/docs/dev-db-reset.md` (new).
