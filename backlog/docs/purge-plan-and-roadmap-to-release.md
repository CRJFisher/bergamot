# Purge Plan & Roadmap to Release

This is the canonical plan for taking bergamot to its lean release shape. It removes the markdown
database and the PKM memory system, fixes every build-breaking entanglement those removals expose,
and sequences the remaining feature work into atomic, testable phases.

## 1. What we keep (the lean core)

The product is a website-visit knowledge base with three jobs and three ways to query it.

- **Capture & record.** The browser extension captures visits and POSTs them to the local HTTP
  server. The server records each visit as a relational row in **DuckDB**.
- **Extract & process.** The LLM categorization/extraction workflow (`simple_workflow.ts`, driven by
  `reconcile_webpage_trees_workflow_vanilla.ts`) extracts the main content of each page. The LLM also
  decides whether to save images/diagrams that carry essential information.
- **Chunk & embed.** A RAG pipeline (task 31 series) chunks page content and stores vectors in
  **LanceDB** (`LanceDBMemoryStore`, wired as `memory_db`).
- **Query.** Clients read the data three ways: direct DB access, a skill + scripts, or the **MCP
  server** / HTTP query API. Queries include sort-by-time, date-range, and hybrid (dense + BM25)
  search.

`memory_db` is the LanceDB vector store and is **kept**. It is unrelated to the PKM `memory/`
directory being removed. Do not conflate them.

## 2. Purge list

### Files to delete entirely

**Markdown DB subsystem:**

- `/Users/chuck/workspace/bergamot/vscode/src/markdown_db.ts` — markdown store + `WebpageTreeNodeCollectionSpec`.
- `/Users/chuck/workspace/bergamot/vscode/src/markdown_db.test.ts`
- `/Users/chuck/workspace/bergamot/vscode/src/note_tools.ts` — scans `~/workspace/pkm` for notes.
- `/Users/chuck/workspace/bergamot/vscode/src/note_tools.test.ts`
- `/Users/chuck/workspace/bergamot/vscode/src/model_schema.ts` — `NoteSchema` + `Note`, used only by the two files above and by the PKM functions in `lance_db.ts`.

**PKM memory subsystem:**

- `/Users/chuck/workspace/bergamot/vscode/src/memory/` (entire directory): `episodic_memory_store.ts`,
  `procedural_memory_store.ts`, `procedural_rule_commands.ts`, `memory_enhanced_classifier.ts`,
  `feedback_commands.ts`, `feedback_document_generator.ts`, `types.ts`, and `__tests__/`
  (`episodic_memory_simple.test.ts`, `procedural_memory_store.test.ts`).
- `/Users/chuck/workspace/bergamot/vscode/src/workflow/enhanced_webpage_filter.ts` — wraps base classification with procedural + episodic layers.
- `/Users/chuck/workspace/bergamot/vscode/src/workflow/content_analyzer.ts` — **verifier-confirmed deletion**. Its sole export `extract_content_features()` returns `ContentFeatures` (imported from `memory/types`) and is called only from the memory-classification block of `simple_workflow.ts` (line 162) that is being deleted. Deleting `memory/` breaks its top-level import, and it has no non-memory caller.

**Disputed items — resolution:**

- `agent_memory.test.ts` (verifier: "delete or refactor"). **Refactor, do not delete.** Lines 71–514
  test the kept `LanceDBMemoryStore` core (`create`/`get`/`put`/`search`/`delete`/`batch`/
  `list_namespaces`/`debug_table`/`start`/`stop`). Lines 4–9, 14, 47–69, 123, 141, and the two
  `describe` blocks at lines 516 and 648 test the PKM note functions and must be stripped. See "Files
  to edit" below.

### Files to edit (surgical)

NO-BACKWARDS-COMPAT applies: update every caller to the new shape. No shims, no optional fields kept
"just in case", no dead functions left behind.

**`vscode/src/lance_db.ts`** — _missed by both maps; verifier-confirmed build-breaker._ This is
keep-core but has hard top-level imports of deleted modules.

- Remove imports `Note, NoteSchema` from `./model_schema` (lines ~53–55) and `NoteTools` from `./note_tools` (line 56).
- Remove the `NOTE_DESCRIPTIONS` entry from `MEMORY_NAMESPACES` (line 60).
- Remove the `should_populate_note_descriptions` block (lines 122–128) from `create()`.
- Delete `create_note_descriptions_table()` (lines ~579–617) — otherwise it is dead code that still references the deleted `NoteTools`/`NoteSchema`.
- Delete `retrieve_similar_notes()` (lines ~639–694) and `retrieve_similar_notes_with_recency()` (lines ~729+) — PKM-only, return `Note[]`, used only by `agent_memory.test.ts`.
- Keep everything else: `WEBPAGE_CONTENT_NAMESPACE`, search, vector ops, the store lifecycle.

**`vscode/src/agent_memory.test.ts`** — _missed by both maps._

- Remove imports of `retrieve_similar_notes`, `retrieve_similar_notes_with_recency`, `NoteTools`, `Note` and the `jest.mock("./note_tools")` call.
- Remove the `mockNotes` fixture and the `NoteTools.fetch_existing_notes` mock setup/assertions.
- Delete the `retrieve_similar_notes` and `retrieve_similar_notes_with_recency` describe blocks.
- Keep the `LanceDBMemoryStore` describe block.

**`vscode/src/extension.ts`**

- Remove `const markdown_path = ConfigManager.get_markdown_db_path(context)` and `ConfigManager.get_memory_config()`.
- Call `initialize_all()` with neither `markdown_path` nor `memory_enabled`. Destructure only `{ duck_db, memory_db }`.
- Construct `ServerManager` and `CommandManager` with only `{ duck_db, memory_db, ... }` — no `markdown_db`, `episodic_store`, or `procedural_store`.
- Update the activation JSDoc to drop "episodic and procedural memory systems".

**`vscode/src/database/database_manager.ts`**

- Remove imports of `MarkdownDatabase`, `EpisodicMemoryStore`, `ProceduralMemoryStore`.
- `DatabaseInstances` interface (rename to `CoreDatabases` for clarity) becomes exactly `{ duck_db: DuckDB; memory_db: LanceDBMemoryStore }`.
- Delete `initialize_core_databases()` (it only built DuckDB + MarkdownDatabase) and `initialize_memory_features()` entirely.
- `initialize_all()` loses `markdown_path` and `memory_enabled` params; it initializes DuckDB and LanceDB inline and returns `{ duck_db, memory_db }`.

**`vscode/src/config/config_manager.ts`**

- Delete `get_markdown_db_path()` and `get_memory_config()` entirely (no callers remain after extension.ts is updated).

**`vscode/src/workflow/simple_workflow.ts`**

- Remove imports of `MemoryEnhancedClassifier`, `EpisodicMemoryStore`, `ProceduralMemoryStore`, `MarkdownDatabase`, `WebpageTreeNodeCollectionSpec`, and `extract_content_features` (from the deleted `content_analyzer`).
- `WebpageWorkflow` constructor: drop `markdown_db`, `episodic_store`, `procedural_store` params and the corresponding fields (`memory_classifier`, `enhanced_filter`, the two stores). The kept params are `openai_key`, `duck_db`, `memory_db`, `filter_config`.
- Delete the conditional memory-initialization (lines ~122–132).
- Replace the memory-classification block (lines ~171–211) with a direct `await classify_webpage(...)` call. **This preserves the plain LLM categorization path** — `classify_webpage` from `webpage_filter.ts` is the base classifier the memory layer used to wrap.
- Delete the `extract_content_features` call (line 162) and the `store_classification_episode` call (lines ~183–188).
- Delete the `this.markdown_db.upsert(WebpageTreeNodeCollectionSpec, new_tree, '## Webpages')` block (lines ~353–359). **No DuckDB migration is required:** the tree is already persisted to DuckDB via `insert_webpage_tree_intentions()` (line 328) and `insert_webpage_tree()` exists in `duck_db.ts` (line 804). The markdown upsert is a redundant human-readable export only.

**`vscode/src/reconcile_webpage_trees_workflow_vanilla.ts`** — this is the active workflow (imported by `visit_queue_processor.ts`), not dead code.

- Remove imports of `MarkdownDatabase`, `EpisodicMemoryStore`, `ProceduralMemoryStore`.
- `build_workflow()` signature drops `markdown_db`, `episodic_store`, `procedural_store`; it passes `openai_key`, `duck_db`, `memory_db`, `filter_config` to the `WebpageWorkflow` constructor.

**`vscode/src/server/server_manager.ts`**

- Remove imports of `MarkdownDatabase`, `EpisodicMemoryStore`, `ProceduralMemoryStore`.
- `ServerConfig` drops `markdown_db`, `episodic_store`, `procedural_store`.
- `setup_workflow()` calls `build_workflow()` without those three args.

**`vscode/src/commands/command_manager.ts`**

- Remove imports of the memory stores, `register_procedural_rule_commands`, `register_feedback_commands`, `FeedbackDocumentGenerator`.
- `CommandConfig` drops `markdown_db`, `episodic_store`, `procedural_store`.
- Delete `register_memory_commands()` and its call from `register_all()`. Keep `searchWebpages`/`showFilterMetrics`-style core query commands.

### Test files to edit

- `simple_workflow.test.ts` — remove the `MarkdownDatabase` mock, `mockMarkdownDb` setup, the `markdown_db` constructor arg, `mockMarkdownDb.upsert` assertions, the `jest.mock("./content_analyzer")` and `extract_content_features` spy/assertions, and any memory-store mocks.
- `database_manager.test.ts` — remove `initialize_core_databases()`/`initialize_memory_features()` tests; assert the result is exactly `{ duck_db, memory_db }`.
- `server_manager.test.ts` — remove `markdown_db`/memory stores from the `ServerConfig` mock and `build_workflow` import expectations.
- `command_manager.test.ts` — remove `markdown_db`/memory stores from the `CommandConfig` mock.
- `config_manager.test.ts` — remove `get_markdown_db_path()` and `get_memory_config()` tests.
- `reconcile_webpage_trees_workflow_vanilla.test.ts` — remove memory-store imports and the `build_workflow` args.
- `visit_queue_processor.test.ts` — update if it constructs `build_workflow` with removed args.

### Browser extension

- `browser/src/content.ts` — rename `initialize_pkm` to `initialize_content_capture` and update the event listener (line 85) and direct call (line 88). Cosmetic only; no functional change. No DB knowledge lives in the browser.

### Docs & tasks to delete/update

Delete:

- `/Users/chuck/workspace/bergamot/docs/AGENT_MEMORY_RESEARCH.md`
- `/Users/chuck/workspace/bergamot/backlog/archive/tasks/task-8 - Add-agent-memory-and-feedback-system-for-webpage-filtering.md`
- `/Users/chuck/workspace/bergamot/backlog/archive/tasks/task-10 - Implement-procedural-memory-for-custom-filtering-rules.md`

Update (remove markdown-as-a-store and memory/feedback references; present-tense, self-contained):

- `backlog/docs/overhaul-roadmap.md` — storage decision becomes "Keep DuckDB + LanceDB as the canonical stores (markdown export removed)"; data flow becomes `→ DuckDB (relational) + LanceDB (vectors) → MCP server tools`.
- `backlog/docs/rag-pipeline-upgrade-plan.md` — drop markdown from the line-3 intro and the baseline Ingestion row; ingestion is "LLM extracts main content, stored in DuckDB + LanceDB (`simple_workflow.ts`)".
- `backlog/docs/query-interface.md` — delete the Markdown export bullet (lines 14–15) and any `bergamot.markdownDbPath` mention.
- `backlog/WORK_PRIORITY.md` — see Phase 6e. Remove procedural/episodic achievements (lines 70–71), the "configuration UI for procedural memory rules" item (line 27), and the stale native-messaging/Firefox items (lines 44, 83, 93).
- `README.md` — remove "learns from your feedback", the Managing Filters feedback/review section, and `bergamot.agentMemory.*` from the config table. Simplify Key Features to capture / store (DuckDB + LanceDB) / query (MCP).

### Config & packaging (vscode/package.json)

- Remove commands: `showMemoryStats`, `correctDecision`, `correctType`, `addExplanation`,
  `generateFilteringReview`, `createFilterRule`, `manageFilterRules`, `createDomainRule`,
  `createContentPatternRule`, `showRuleStatistics`, `exportFilterRules`, `importFilterRules`,
  `addHighlight`.
- Remove settings: `bergamot.markdownDbPath`, `bergamot.agentMemory.enabled`,
  `bergamot.agentMemory.recentPagesDays`, `bergamot.agentMemory.filteredPagesHours`.
- Keep settings: `bergamot.openaiApiKey`, `bergamot.webpageFilter.enabled`,
  `bergamot.webpageFilter.allowedTypes`, `bergamot.webpageFilter.minConfidence`. Keep
  `searchWebpages` and `showFilterMetrics`.

## 3. Removal order (dependency-safe sequence)

Leaves first so the TypeScript build never breaks mid-way. Each step compiles on its own.

1. **Strip & fix tests** (leaves). Edit `agent_memory.test.ts`, `simple_workflow.test.ts`,
   `database_manager.test.ts`, `server_manager.test.ts`, `command_manager.test.ts`,
   `config_manager.test.ts`, `reconcile_webpage_trees_workflow_vanilla.test.ts`,
   `visit_queue_processor.test.ts` to stop referencing memory/markdown/note symbols.
2. **Decouple `lance_db.ts`** (keep-core leaf with bad imports). Remove the note imports, the
   `NOTE_DESCRIPTIONS` namespace + populate block, and the three PKM functions. This must happen
   **before** deleting `note_tools.ts`/`model_schema.ts`, or the build breaks.
3. **Excise the memory_enhanced_classifier path** from `simple_workflow.ts`: drop memory imports and
   the `content_analyzer` import, replace the memory-classification block with the direct
   `classify_webpage` call, delete the constructor stores, and delete the markdown upsert. The plain
   LLM categorization path is now the only path and is fully preserved.
4. **Update commands.** `command_manager.ts`: delete `register_memory_commands()` and its imports.
5. **Update wiring.** `reconcile_webpage_trees_workflow_vanilla.ts`, `server_manager.ts`,
   `extension.ts`: drop the removed params from `build_workflow`/configs/`initialize_all`.
6. **Refactor core init.** `database_manager.ts`: collapse to `{ duck_db, memory_db }`;
   `config_manager.ts`: delete the two getters.
7. **Delete core files.** `vscode/src/memory/` (whole dir), `enhanced_webpage_filter.ts`,
   `content_analyzer.ts`, `markdown_db.ts(.test)`, `note_tools.ts(.test)`, `model_schema.ts`.
8. **Config.** Edit `vscode/package.json` (commands + settings).
9. **Browser.** Rename `initialize_pkm`.
10. **Docs & tasks.** Apply the doc edits and deletions.
11. **Verify.** `npm run build` and `npm test` in `vscode/` are green; activation initializes only
    DuckDB + LanceDB; no memory commands in the palette.

## 4. Risks & entanglements

| Severity                | Entanglement                                                                                         | Handling                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **High (missed)**       | `lance_db.ts` top-level imports of `NoteTools`/`Note`/`NoteSchema` (keep-core, omitted by both maps) | Step 2: remove imports, namespace, populate block, and the three PKM functions before deleting their modules.                                                  |
| **High (missed)**       | `agent_memory.test.ts` imports deleted note modules                                                  | Step 1: strip note imports/mocks and the two PKM describe blocks; keep the `LanceDBMemoryStore` tests.                                                         |
| **Medium (missed)**     | `content_analyzer.ts` imports `memory/types` and is only used by the deleted memory path             | Delete the file (Step 7); remove its import + call from `simple_workflow.ts` (Step 3).                                                                         |
| **High**                | `memory_enhanced_classifier` wraps `classify_webpage`                                                | Step 3: revert to a direct `classify_webpage` call. Categorization quality is unaffected; only the correction-learning layer is gone.                          |
| **High**                | `DatabaseInstances` returns markdown/memory stores; all managers unpack them                         | Step 6 + 5: collapse to `CoreDatabases { duck_db, memory_db }`; update all unpack sites mechanically.                                                          |
| **Medium**              | `build_workflow` 8-param signature                                                                   | Step 5: reduce to `openai_key, duck_db, memory_db, filter_config`.                                                                                             |
| **Disputed (resolved)** | Webpage-tree storage "needs migration to DuckDB" (claimed by keep_core map)                          | **No migration.** The tree is already written to DuckDB via `insert_webpage_tree_intentions()`; the markdown upsert is redundant export and is simply deleted. |
| **Low**                 | `feedback_document_generator.ts` writes markdown from episodic memory                                | Deleted with `memory/`; episodic data never persists post-removal, no replacement needed.                                                                      |
| **Low**                 | Browser `initialize_pkm` naming                                                                      | Cosmetic rename.                                                                                                                                               |

The MCP standalone server, `webpage_search_commands.ts`, and `webpage_hover_provider.ts` depend only
on `memory_db` (LanceDB) and need no changes.

## 5. Roadmap to release

Phases 0–5 are done (transport consolidation, e2e harness, DuckDB/LanceDB setup, relational MCP
tools + HTTP query API). Each phase below is one atomic, testable PR set in the overhaul-roadmap
style.

### Phase 6 — The purge (this document, Sections 2–3) — DONE

The lean-core refactor, tracked by **task-33** (Done, archived). Executed in the dependency-safe
removal order: tests + `lance_db` decouple → `simple_workflow` memory excision → wiring/init collapse
→ file deletions + `package.json` → docs/`WORK_PRIORITY` refresh.

- The markdown DB and the PKM memory system are deleted; `lance_db.ts` is decoupled from the note
  modules; `simple_workflow.ts` runs a single direct `classify_webpage` path; wiring carries only
  `duck_db` + `memory_db`; `package.json` exposes only `searchWebpages` + `showFilterMetrics`.
- Docs refreshed: `overhaul-roadmap.md`, `rag-pipeline-upgrade-plan.md`, `query-interface.md`,
  `WORK_PRIORITY.md` (was stale — native messaging, Firefox, procedural/episodic memory), `README.md`.
- **Verified.** vscode tsc 0 errors, eslint 0 errors, jest 242/242 across 16 suites, browser tsc clean;
  activation initializes only DuckDB + LanceDB; palette free of memory commands.

### Phase 7 — Image-aware content extraction

The LLM decides whether to save images/diagrams that carry essential information (e.g. architecture
diagrams, charts). Today `prompts.ts` only tells the model to keep inline image markdown; there is no
save/extract path.

- Tracked by **task-32 — LLM-gated image/diagram extraction**. The extraction prompt asks the LLM to
  flag content-critical images; flagged images are persisted (path/URL recorded in the DuckDB analysis
  row) and made available to RAG ingestion; decorative images are dropped.
- Aligns with **task-31.5** (clean ingestion / main-content extraction); coordinate the two.

### Phase 8 — RAG pipeline (task 31 series)

The major feature work. Sequence by the existing sub-tasks:

- **31.1** RAG evaluation harness (measurement spine) — first, it gates the rest.
- **31.6** Embedding model evaluation/selection.
- **31.3** Chunking (Contextual Retrieval / parent-document).
- **31.2** Hybrid search (dense + BM25 fused via RRF).
- **31.4** Reranking over hybrid candidates.
- **31.8** MCP generation-time: citations, ordering, small-corpus short-circuit.
- **31.7** Query transformation (HyDE / multi-query) — optional.
- **31.9** Decision record: defer advanced architectures.
- **task-30** (Evaluate and improve RAG in MCP) folds into 31.1/31.8 — close it as superseded by the
  31 series, or convert it into the acceptance gate for Phase 8.

### Phase 9 — Query interface completeness

`query-interface.md` already documents: where data lives, the DuckDB schema, MCP tools, the HTTP
query API, and direct DuckDB access (including a `ORDER BY page_loaded_at DESC` time-sort example).

Gaps to close (after the Phase-6 markdown-export bullet is removed):

- **Sort-by-time** — formalize as a first-class MCP/HTTP parameter (the doc only shows it as raw SQL).
- **Date-range queries** — add an explicit `from`/`to` parameter to MCP + HTTP query tools; currently absent.
- **Hybrid search** — delivered by **task-31.2**; expose it through MCP and document it here.
- **task-29** (SQL-like query interface) maps here; reconcile its scope against what already ships.

### Phase 10 — Release readiness

- Packaging: build/bundle both extensions; ensure the MCP server ships with RAG tools.
- Documentation: README + `query-interface.md` reflect capture / store / query only.
- Marketplace: **task-24** (marketing materials) and **task-25** (documentation overhaul) map here.

### Task disposition

| Task                       | Disposition                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| task-31 + 31.1–31.9        | Phase 8 (core feature work) — open                                                                           |
| task-30                    | **Closed** — superseded by 31.1/31.8; archived                                                               |
| task-29                    | Phase 9 (query interface) — open                                                                             |
| task-24, task-25           | Phase 10 (release) — open                                                                                    |
| task-22                    | Keep — categorization evaluation, still relevant                                                             |
| task-27, task-28           | **Demoted to drafts** (draft-1, draft-2) — local/fine-tuned classification is out of lean-core scope (YAGNI) |
| task-18.8                  | Keep — performance, relevant at release                                                                      |
| task-8, task-10 (archived) | **Deleted** — memory systems removed                                                                         |
| task-33                    | **Phase 6 (the purge) — Done, archived**                                                                     |
| task-32                    | Phase 7 (image extraction) — open                                                                            |
