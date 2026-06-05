---
id: TASK-35.12
title: Decouple LanceDB from the capture and query flow
status: Done
assignee: []
created_date: "2026-06-05"
labels:
  - pipeline
  - refactor
  - rag
dependencies:
  - TASK-35.4
references:
  - vscode/src/database/database_manager.ts
  - vscode/src/lance_db.ts
  - vscode/src/workflow/embeddings.ts
  - vscode/src/mcp_server_standalone.ts
  - vscode/src/webpage_search_commands.ts
  - vscode/src/webpage_hover_provider.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

After task-35.4 ingestion writes nothing to LanceDB, so the vector store is never populated and every LanceDB read returns empty. Per the user decision, completely decouple LanceDB from the capture and query flow now: remove all wiring/imports that link LanceDB into the pipeline so nothing in the core path depends on it. The npm library deps (`@lancedb/lancedb`, `@xenova/transformers`) stay installed — they are not causing an issue — but our wrapper modules and their usages are removed. Semantic search is deferred to the RAG-prep pipeline (task-31), which will reintroduce vector search as a separate, opt-in module.

This means: drop `memory_db` from `DatabaseManager`, `extension.ts`, `ServerManager`/`server_standalone`, `VisitQueueProcessor`, `WebpageWorkflow`, `build_workflow`, and the DuckDB read functions (`get_page_sessions_with_tree_id`, `get_last_modified_trees_with_members_and_analysis`, `get_page_by_title`, `row_to_page_activity_session_with_meta`, `get_webpage_content`); remove the MCP `semantic_search` tool (keep DuckDB-backed `search_by_title`); and remove the LanceDB-backed VS Code query consumers' dependency (`webpage_search_commands`, `webpage_hover_provider`, `command_manager`). Delete the now-orphaned wrapper modules `lance_db.ts`, `workflow/embeddings.ts` and their tests. No shims.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 No module in the capture/query flow imports `LanceDBMemoryStore` or `create_embeddings`; `memory_db` is removed from `DatabaseManager`, `extension.ts`, `ServerManager`/`server_standalone`, `VisitQueueProcessor`, `WebpageWorkflow` and `build_workflow`
- [x] #2 DuckDB read functions no longer take/ use a `memory_db` param; page content is no longer fetched from LanceDB (content comes from the capture store / DuckDB metadata)
- [x] #3 The MCP `semantic_search` tool is removed (deferred to task-31); `search_by_title` (DuckDB) still works; the MCP server no longer opens a LanceDB store
- [x] #4 The orphaned wrappers `lance_db.ts` and `workflow/embeddings.ts` (and their tests) are deleted; `@lancedb/lancedb` and `@xenova/transformers` remain in package.json as unused-for-now library deps
- [x] #5 All tests pass; no LanceDB store is created during ingestion, query, or extension startup; semantic search deferral is documented
<!-- AC:END -->

## Implementation Notes

LanceDB is fully decoupled from the capture and query flow.

- **memory_db removed** from `DatabaseManager` (no `initialize_memory_store`, no embeddings), `extension.ts`, `ServerManager`/`ServerConfig`, `server_standalone.ts`, `VisitQueueProcessor`, `WebpageWorkflow`, and `build_workflow`. Ingestion and extension startup open only DuckDB.
- **DuckDB read functions** no longer take a `memory_db` param; page content is never fetched from LanceDB. Session-meta `content` is `""`; the raw page is read on demand via `read_capture` (`webpage_capture`).
- **MCP** (`mcp_server_standalone.ts`): `semantic_search` removed (deferred to task-31); the server no longer opens a LanceDB store. `get_webpage_content` routes to the new `/query/capture_content` endpoint (decompresses `webpage_capture`). `search_by_title` / tree tools still work via DuckDB over HTTP.
- **Query consumers**: `webpage_search_commands.ts` deleted (semantic search deferred; `bergamot.searchWebpages` command removed from package.json + CommandManager). `webpage_hover_provider.ts` reads capture metadata from DuckDB only (no content preview).
- **Orphans deleted**: `lance_db.ts`, `workflow/embeddings.ts`, `agent_memory.test.ts`, `workflow/embeddings.test.ts`, `webpage_search_commands.ts`. `@lancedb/lancedb` and `@xenova/transformers` remain in package.json as unused-for-now library deps per the user decision.
- All 195 tests pass; production esbuild bundle builds clean. Semantic-search deferral documented in the architecture docs.

Files: `database/database_manager.ts`, `extension.ts`, `server/server_manager.ts`, `server/server_standalone.ts`, `visit_queue_processor.ts`, `workflow/simple_workflow.ts`, `reconcile_webpage_trees_workflow_vanilla.ts`, `duck_db.ts`, `mcp_server_standalone.ts`, `webpage_hover_provider.ts`, `commands/command_manager.ts`, `package.json`, deletions above, plus tests.
