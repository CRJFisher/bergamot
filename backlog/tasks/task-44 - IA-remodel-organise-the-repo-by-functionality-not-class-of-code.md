---
id: TASK-44
title: "IA remodel: organise the repo by functionality, not class of code"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - epic
dependencies: []
references:
  - browser/src/core
  - vscode/src
  - tdt/src
  - scripts/check_naming_conventions.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Epic from the 2026-07-07 information-architecture deep review. The rule every sub-task enforces: **a file lives with the feature that consumes it, types live with the code they describe, and a folder exists only when a functionality has ≥2 files.** Class-of-code groupings (`utils`, `types`, `models`, `core`, `helpers`, `shared`) are verboten — both as folders and as file-name suffixes that split a schema or helper away from its owning module.

**Intent-tree node:** cross-cutting — comprehension cost of the codebase. Principle 11 (no surplus code) and principle 12 (docs describe the system as it is) are the constitutional hooks.

The review's findings, one sub-task each:

| Sub-task  | Area                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| TASK-44.1 | Browser: dissolve `core/` + `types/` into functional modules                         |
| TASK-44.2 | VSCode: gather the visit-ingestion pipeline; colocate the `*_models.ts` schemas      |
| TASK-44.3 | VSCode: dissolve `config/` and `database/` into functional homes                     |
| TASK-44.4 | VSCode: consolidate MCP serving into one `mcp/` module                               |
| TASK-44.5 | VSCode: split the `server_manager.ts` god object                                     |
| TASK-44.6 | tdt library: colocate `types.ts` / `config.ts` with their functional modules         |
| TASK-44.7 | vscode/src/tdt: evict non-domain infra; substructure by sub-function                 |
| TASK-44.8 | Cross-cutting: fix stale docs, write the IA rule down, extend mechanical enforcement |

What the review found **right** and these tasks must preserve: the tdt ports seam (`tdt/src/ports.ts` — four contracts, one host implementation each, zero leakage), the `redownload/` folder, and `duck_db/`'s read/write split. The whole dependency graph is already acyclic; every sub-task is placement and naming, executed as rename-first PRs in the task-35.11 style (git mv, all callers updated, colocated tests move with their code, no aliases or transitional re-exports).

### Dependency graph

```
TASK-44.2 ──► TASK-44.5
TASK-44.3 ──► TASK-44.5
TASK-44.7 ──► TASK-44.5
TASK-44.1 ──► TASK-44.8
TASK-44.2 ──► TASK-44.8
TASK-44.3 ──► TASK-44.8
TASK-44.4 ──► TASK-44.8
TASK-44.5 ──► TASK-44.8
TASK-44.6 ──► TASK-44.8
TASK-44.7 ──► TASK-44.8
```

### Waves

- **Wave 1** (independent, any order): TASK-44.1, TASK-44.2, TASK-44.3, TASK-44.4, TASK-44.6, TASK-44.7
- **Wave 2**: TASK-44.5 (imports move in 44.2/44.3; its extracted clustering orchestration lands in the folder shape 44.7 settles)
- **Wave 3**: TASK-44.8 (enforcement must not fire on offenders that still exist; the README structure section describes the final layout)

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 All eight sub-tasks are Done
- [ ] #2 No folder or file in browser/src, vscode/src, or tdt/src is named for a class of code (utils, types, models, core, helpers, shared, common)
- [ ] #3 The tdt ports seam, redownload/, and duck_db/ read-write split are unchanged in shape
- [ ] #4 Full workspace test suite, tsc, and lint pass after each wave

<!-- AC:END -->
