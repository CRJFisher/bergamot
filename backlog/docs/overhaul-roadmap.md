# Bergamot Overhaul Roadmap

Canonical plan for the web-tracking + e2e overhaul. Each item is intended to be a single, atomic, testable PR.

## Goal

Preserve the core product — a durable record of web-page tracking (cross-page/multi-tab sessions identified by `group_id`) — and make that record reliably queryable by other processes through an easy interface (MCP tools + a documented DuckDB schema). Add a solid cross-tab e2e suite suitable for agentic coding.

## Locked decisions

- **Storage:** Minimal. Fix the data-loss bugs and wire the existing DuckDB query helpers into MCP. Keep DuckDB + LanceDB + markdown as separate stores (no single-store collapse).
- **Transport:** Delete native messaging entirely. Standardize on a single authenticated local HTTP transport with a single canonical port-discovery file.
- **Browser targets:** Chromium-only. Drop the Firefox manifest/build and cross-browser shims.
- **LangChain:** Remove `@langchain/*`; reimplement page categorization with direct OpenAI calls.
- **e2e framework:** Playwright (`@playwright/test`), persistent context with the MV3 extension loaded, asserting on captured visit records via the existing mock PKM server. LLM is stubbed in e2e (real workflow exercised in a separate slow tier later).

## Target data flow

```
[web page] -> content.ts -> background.ts (session graph)
   -> single HTTP POST localhost:<port>/visit  (token-authenticated, CORS pinned to extension)
   -> VS Code Express server -> durable visit ingestion
   -> DuckDB (relational record) + LanceDB (vectors) + markdown (on-demand-ish export)
   -> MCP server: relational tools (list/get by url/title/date/tree) + vector tools (semantic_search, get_webpage_content)
```

## Phases

### Phase 0 — Stop the bleeding + hygiene
- **0.1 [DONE]** Remove `fs.unlinkSync` from DuckDB constructor; `init()` is open-or-create; `read_only` honored via `access_mode`. (`vscode/src/duck_db.ts`)
- **0.2 [DONE]** Stop the standalone MCP server from constructing/initing DuckDB (it never queried it). (`vscode/src/mcp_server_standalone.ts`)
- **0.3 [DONE]** Align LanceDB writer path with the MCP reader path (`webpage_memory.db` subdir). (`vscode/src/database/database_manager.ts`)
- **0.4** Delete repo cruft: `README-original.md`, `README_old.md`, `RELEASE_SUMMARY.md`, `package.json.backup`, `knowledge-thoughts.png`, empty `data/`, `langmem course notebooks/`, `mcp_study_guide/`, stale `out/`, empty `vscode/src/suggestion_decorations.ts`, stale `docs/DEAD_CODE_ANALYSIS.md`. (confirm with owner first)
- **0.5** Resolve `.gitignore` contradictions (keep committed lockfile; ignore `*.backup`, build output).

### Phase 1 — e2e harness (top priority)
- **1.1** Add `@playwright/test`; remove `chrome-remote-interface` + all `e2e/*cdp*.ts` / tsx scripts; add `playwright.config.ts`; `playwright install chromium`.
- **1.2** Build the extension fixture (`test.extend`): persistent context + `service_worker` + `extension_id`, with CI-resilient SW-attach retry (CDP restart workaround).
- **1.3** Cross-tab specs (new tab via `target=_blank` / ctrl-click / `window.open`; opener inheritance; SPA navigation) asserting on `mock_pkm_server` visit records. Confirm payload fields (`opener_tab_id`, navigation chain) exist before asserting.
- **1.4** CI workflow runs Playwright headless via `channel: 'chromium'`.

### Phase 2 — Transport consolidation [DONE]
Discovery approach chosen: **HTTP port-range probing** (browser has no filesystem access, so it cannot read a port file — it probes the candidate range and matches a `/status` service marker). See [[native-messaging-vs-http-discovery]].
- **2.1 [DONE]** Collapsed browser transport to the single pure `send_to_server`; removed the double fallback in `message_router`; deleted `api_client_v2.ts` (stateful class).
- **2.2 [DONE]** Deleted all native messaging: `native-host/`, `vscode/resources/native_host.js`, `vscode/src/browser_integration/` (installer/verifier/wizard/orchestrator), `browser/src/core/native_messaging.ts`, native HTTP test, extension.ts wiring.
- **2.3 [DONE]** Server binds first free port in `SERVER_PORT_RANGE` (5000–5009) and writes canonical `~/.bergamot/port.json` (for other processes). Browser `server_discovery.ts` probes the range; `handle_server_request` tries the cached/default URL then re-discovers on failure.
- **2.4 [DONE]** `/status` returns a `{ service: "bergamot" }` identity marker; CORS pinned to `chrome-extension://` origins (blocks web pages) on a loopback-bound server. (No shared token: a filesystem-less extension can't be handed one; origin pinning + loopback is the boundary.)
- **2.5 [DONE]** Trimmed manifest permissions to `tabs`, `activeTab` (removed `scripting`, `webRequest`, `nativeMessaging`); dropped Firefox (manifest, build/copy/package/publish/version-bump/test wiring, gecko block). Chromium-only.

### Phase 3 — Browser session-graph robustness
- **3.1** Move navigation detection to `chrome.webNavigation` (`onCommitted`, `onHistoryStateUpdated`, `onCreatedNavigationTarget`); remove the MutationObserver.
- **3.2** Persist `tab_history_store` in `chrome.storage.session`; `group_id` minting becomes background-only (single authority).
- **3.3** Content-size cap + debounce for SPA captures; move zstd compression off the page main thread; gate logging behind `log_level`.

### Phase 4 — Query interface polish
- **4.1** Wire relational MCP tools using existing `duck_db.ts` helpers: `list_recent_visits`, `get_visit_by_url`, `search_by_title`, `list_navigation_trees`, `get_tree`. Resolve cross-process DuckDB access (extension holds it; MCP opens read-only or queries via the server).
- **4.2** Dedupe `mcp_server.ts` / `mcp_server_standalone.ts` into one shared module; pick one entry point.
- **4.3** Config-derive the markdown path (remove hardcoded `/Users/chuck/...`).
- **4.4** One-page schema doc + dependency-free example (open DuckDB read-only, run SQL) as the documented "easy interface."
- **4.5** Durable visit inbox: persist ingestion queue / orphan state so restarts don't drop in-flight visits.

### Phase 5 — LangChain removal
- **5.1** Remove `@langchain/*`; reimplement the categorization workflow with direct OpenAI calls. Correct/replace `WORK_PRIORITY.md` and any docs claiming it was already removed.
