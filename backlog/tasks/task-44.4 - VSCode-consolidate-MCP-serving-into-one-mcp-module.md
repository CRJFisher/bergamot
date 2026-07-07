---
id: TASK-44.4
title: "VSCode: consolidate MCP serving into one mcp/ module"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - vscode
  - mcp
dependencies: []
references:
  - vscode/src/mcp_server_standalone.ts
  - vscode/src/server/mcp_server_manager.ts
  - vscode/src/server/server_standalone.ts
  - vscode/src/extension.ts
parent_task_id: TASK-44
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

MCP serving is split across two locations with rhyming names that mix two functionalities: `mcp_server_standalone.ts` (the headless MCP entry point) sits at the top level, `server/mcp_server_manager.ts` (child-process spawner for it) sits inside the HTTP-server folder, and `server/server_standalone.ts` (headless _HTTP_ entry) rhymes with the first despite being a different feature.

**Scope**

- Create `vscode/src/mcp/` holding the MCP pair: `mcp_server_standalone.ts` → `mcp/server.ts` (the standalone entry), `server/mcp_server_manager.ts` → `mcp/process_manager.ts` (spawns the child with deferred start).
- `server/server_standalone.ts` stays in `server/` — it is the headless variant of the HTTP server and is correctly placed; only the MCP files move.
- Update spawn paths (the process manager forks the standalone entry by compiled path — verify `out/` layout after the move), `extension.ts` wiring, and any package.json `bin`/entry references.

Renames via `git mv`; colocated tests move; no aliases or re-exports.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 vscode/src/mcp/ holds the MCP entry point and its process manager; no MCP file remains at the top level or in server/
- [ ] #2 The MCP child process spawns and serves correctly from the new compiled path (manual or integration verification)
- [ ] #3 All tests pass; tsc and lint clean

<!-- AC:END -->
