---
id: TASK-33
title: Purge markdown DB + PKM memory system (lean-core refactor)
status: Done
assignee: []
created_date: "2026-06-02 16:52"
updated_date: "2026-06-02 16:52"
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Remove the markdown database and the PKM agent-memory system (episodic memory, procedural memory, feedback) to strip the project to its lean core: capture visits to DuckDB, LLM content extraction, vectors in LanceDB, queryable via MCP/HTTP/direct DB. See backlog/docs/purge-plan-and-roadmap-to-release.md.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 markdown_db, note_tools, model_schema, enhanced_webpage_filter, content_analyzer and the whole vscode/src/memory directory are deleted
- [x] #2 lance_db.ts is decoupled from the deleted note modules (no NOTE_DESCRIPTIONS namespace or retrieve_similar_notes functions)
- [x] #3 simple_workflow.ts uses the direct classify_webpage path with no memory layer and no markdown write
- [x] #4 Wiring (extension/database_manager/server_manager/command_manager/config_manager/reconcile workflow) carries only duck_db + memory_db
- [x] #5 package.json exposes only searchWebpages + showFilterMetrics commands and drops markdownDbPath/agentMemory settings
- [x] #6 vscode tsc + eslint + full jest suite are green and the browser project builds
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->

Executed the purge per backlog/docs/purge-plan-and-roadmap-to-release.md in dependency-safe order. Deleted: markdown_db.ts(.test), note_tools.ts(.test), model_schema.ts, workflow/enhanced_webpage_filter.ts, workflow/content_analyzer.ts, the whole src/memory/ dir, and docs/AGENT_MEMORY_RESEARCH.md. Decoupled lance_db.ts (removed Note/NoteTools imports, MEMORY_NAMESPACES, create_note_descriptions_table, retrieve_similar_notes + \_with_recency). simple_workflow.ts: removed memory_enhanced_classifier/enhanced_filter/content_analyzer + markdown upsert; now a single direct classify_webpage path (tree intentions still persisted to DuckDB via insert_webpage_tree_intentions). Collapsed DatabaseInstances to {duck_db, memory_db}; trimmed ServerConfig/CommandConfig/build_workflow/WebpageWorkflow signatures; deleted ConfigManager.get_markdown_db_path + get_memory_config; removed dead VS Code commands (13) and agentMemory/markdownDbPath settings; dropped onLanguage:markdown activation event. Renamed browser initialize_pkm -> initialize_content_capture. Refreshed overhaul-roadmap, rag-pipeline-upgrade-plan, query-interface, WORK_PRIORITY, README. Verification: vscode tsc 0 errors, eslint 0 errors, jest 242/242 pass across 16 suites, browser tsc clean. No new as-any casts introduced.

<!-- SECTION:NOTES:END -->
