---
id: TASK-44.3
title: "VSCode: dissolve config/ and database/ into functional homes"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - vscode
dependencies: []
references:
  - vscode/src/config/config_manager.ts
  - vscode/src/config/storage_path.ts
  - vscode/src/database/database_manager.ts
  - vscode/src/database/encryption_key.ts
  - vscode/src/duck_db
  - vscode/src/extension.ts
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`config/` and `database/` are class-of-code folders, and `database/` collides with `duck_db/`: `database/database_manager.ts` (42 lines) does not contain the database — it opens the one implemented in `duck_db/`, so one concern is split across two rhyming folders.

**Scope**

- `database/database_manager.ts` and `database/encryption_key.ts` move into `duck_db/` — their function is "open the encrypted metadata store", which belongs to the store. Rename `database_manager.ts` to say what it does (e.g. `duck_db/open_store.ts`).
- `config/storage_path.ts` (resolves where the store lives on disk) moves with the store bootstrap into `duck_db/`.
- `config/config_manager.ts` (reads VS Code settings: dev mode, cluster cadence) moves next to its consumer, the extension lifecycle — e.g. top-level `extension_config.ts` beside `extension.ts`.
- Both folders are deleted. Update importers (`extension.ts`, `server/server_manager.ts`, tdt scheduler). Note: TASK-43's `references` list names `config/config_manager.ts` and `config/storage_path.ts` — update those paths in the task doc so it stays truthful.

Renames via `git mv`; colocated tests move; no aliases or re-exports.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 vscode/src/config/ and vscode/src/database/ no longer exist
- [ ] #2 Opening the encrypted store (manager + key + storage path) lives in duck_db/ under function-named files
- [ ] #3 VS Code settings reading lives with the extension lifecycle
- [ ] #4 TASK-43 references updated; all tests pass; tsc and lint clean

<!-- AC:END -->
