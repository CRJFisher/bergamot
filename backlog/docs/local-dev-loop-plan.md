# Local Development Loop Plan

This document describes how to set up Bergamot for fast local development and testing on macOS, using Brave for the browser extension and Cursor (or VS Code) for the VS Code extension, with webpage classification running on a Claude subscription and strong dev-phase observability.

## Target Setup

A tight local iteration loop with four properties:

- **One command deploys the test build into Brave** — `npm run dev:brave` (in `browser/`) builds straight into `browser/chrome/dist`, starts an esbuild watch, and launches Brave with a persistent dev profile.
- **F5 in Cursor debugs the extension against the real PKM workspace** — `.vscode/launch.json` points `extensionDevelopmentPath` at `vscode/`, opens `/Users/chuck/workspace/pkm` as the Extension Development Host workspace, and writes dev data to a repo-local `.dev-storage`.
- **Classification runs on the Claude subscription** (no API tokens) via a `ClaudeAgentClient` slotted into the existing `LLMClient` seam. Embeddings run on a local model (Claude has no embeddings API).
- **Errors are immediately visible** — a single correlation `visit_id` threads browser → `/visit` → queue → workflow → store, logged to one tail-able JSONL plus a "Bergamot Dev" output channel, with a browser badge on POST failure.

## Architecture Recap

The capture pipeline is: browser extension captures a page → POSTs to the local Express server `/visit` (port discovery over 5000–5009) → visit queue → classification workflow → DuckDB (relational) + LanceDB (vectors) → MCP server exposes it for query.

- Browser extension: `browser/`, esbuild bundles, Chromium manifest in `browser/chrome/`, dev loader `browser/scripts/load-extension.js`.
- VS Code extension: `vscode/`, Express server (`vscode/src/server/server_manager.ts`), DuckDB + LanceDB (`vscode/src/database/database_manager.ts`), MCP server.
- LLM seam: `LLMClient` interface in `vscode/src/workflow/openai_client.ts`; classification in `vscode/src/workflow/webpage_filter.ts` and `vscode/src/workflow/simple_workflow.ts`.

## Sequenced Workstreams

Ordered so a working, iterate-able loop arrives fastest. Phases A–C give a debuggable extension + Brave + visibility; D is the Claude/embeddings swap; E is the trustworthy E2E.

### Phase A — Make F5 actually work (highest leverage, smallest effort)

Today launching "Run Extension" loads nothing: `extensionDevelopmentPath` points at the repo root but the extension lives in `vscode/`, and the `preLaunchTask` references a root `compile` task that does not exist.

- Modify `.vscode/launch.json` — `extensionDevelopmentPath=${workspaceFolder}/vscode`, add bare arg `/Users/chuck/workspace/pkm`, `outFiles=["${workspaceFolder}/vscode/out/**/*.js"]`, `preLaunchTask: "vscode: watch"`, `env: {BERGAMOT_STORAGE_PATH: "${workspaceFolder}/.dev-storage"}`. **[S]**
- Modify `.vscode/tasks.json` — replace root `npm: compile` with `vscode: compile` (cwd `vscode/`, `$tsc`) and a background `vscode: watch` (cwd `vscode/`, `$tsc-watch` matcher). The scripts already exist (`vscode/package.json` `compile`/`watch`). **[S]**
- Modify `vscode/tsconfig.json` — add `"sourceMap": true` so breakpoints bind. **[S]**
- Config hygiene: `.vscode/settings.json` holds a live `sk-proj-` OpenAI key under the stale `pkm-assistant.openaiApiKey` namespace, which the extension never reads (it reads `bergamot.openaiApiKey`, `config_manager.ts`). `.vscode/` is gitignored, so this was never committed to git history — it is local only. Move the real key under `bergamot.openaiApiKey` in user-level Cursor settings, remove the stale entry, and add `.dev-storage/` to `.gitignore`. **[S]**

### Phase B — Dev-storage separation

So debugging does not pollute real PKM data, dev runs write DuckDB/LanceDB/inbox to repo-local `.dev-storage`.

- Add a storage-base helper resolving `process.env.BERGAMOT_STORAGE_PATH ?? context.globalStorageUri.fsPath`, used in `vscode/src/database/database_manager.ts` (DuckDB `webpage_categorizations.db`, LanceDB `webpage_memory.db`) and `vscode/src/extension.ts` (visit inbox). **[M]**
- Forward the same base into the MCP child env in `vscode/src/server/mcp_server_manager.ts` (`STORAGE_PATH`/`DUCK_DB_PATH`) so the standalone MCP reads the dev store too. Writer and reader must stay aligned. **[M]**

### Phase C — Brave one-command deploy + observability

Run in parallel with A/B. `npm run dev:brave` builds → watches → launches Brave with real server discovery active; failures are visible.

- Modify `browser/scripts/load-extension.js` — add the Brave darwin path `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` to the binary list, support a `BROWSER_BIN` override, give Brave its own persistent profile `~/.bergamot-brave-debug-profile`. **[S]**
- Change dev esbuild output to `browser/chrome/dist` and add a `watch` script running both esbuild commands with `--watch`; drop the copy step in the dev loop (a watch on `dist/` leaves `chrome/dist`, what Brave loads, stale). Modify `browser/package.json` and `browser/copy-dist-to-browser-folders.js`. **[M]**
- Add the `dev:brave` script to `browser/package.json`: plain `build` (NOT `build:test`, which injects `MOCK_PKM_PORT` and short-circuits real-server discovery), start watch in background, launch Brave with the persistent profile. **[S]**

Observability (the crucial part — do it here, not last):

- **Correlation `visit_id`**: generate in browser (`browser/src/core/data_collector.ts`), include in the POST body (`browser/src/content.ts`), have `/visit` trust-or-recompute and echo it back (`server_manager.ts` currently computes `md5(url+page_loaded_at)` but never returns it), thread into every log line both sides. **[M]**
- **`vscode/src/dev_log.ts`** (new): one `createOutputChannel('Bergamot Dev')` + append to `<storage-base>/dev-log.jsonl`. Replace scattered `console.*` across `server_manager.ts`, `visit_queue_processor.ts`, `simple_workflow.ts`, `orphaned_visits.ts`. Stages: `http_received, parse_failed, decompress_failed, queued, classify_result, dropped(reason), workflow_failed, stored, orphan_parked, orphan_dropped`. Use async append so the `/visit` 200 is not blocked. **[M]**
- **Per-visit outcome record**: append `{visit_id, url, page_type, confidence, decision, reason, error?}` at the drop/store/fail points (the drop reason is computed in `simple_workflow.ts` then discarded). Add a `bergamot.showVisitOutcomes` command listing recent visits with why each dropped, plus live queue/inbox/orphan counts from the existing `VisitQueueProcessor.get_stats()` and `OrphanedVisitsManager.get_stats()`. **[M]**
- **Browser badge on POST failure**: in `browser/src/core/message_router.ts` set a red `!` `chrome.action` badge on final failure, clear on next success (verify the `action` key exists in the manifest first). **[S]**
- **Replay**: persist last N raw captures + a `bergamot.replayVisit` command to re-run `WebpageWorkflow.run()` without re-browsing. Essential for iterating on prompts and validating the Claude swap. **[M]**

### Phase D — Claude subscription classification + local embeddings

Classification (and the other LLM calls) run on the user's Claude subscription with no API tokens. **Decision made: embeddings move to a local model (true zero-token).**

- Add `@anthropic-ai/claude-agent-sdk` to `vscode/package.json`. **[S]**
- Create `vscode/src/workflow/claude_agent_client.ts` implementing `LLMClient`: `complete()` via the SDK `query({prompt, options:{systemPrompt, model, maxTurns:1, allowedTools:[], settingSources:[]}})`; `complete_json()` reuses the brace/markdown extraction already in `VSCodeLLMClient.complete_json` (the SDK has no `json_object` mode). **[M]**
- **Auth guard**: scrub `ANTHROPIC_API_KEY` from the child env passed to `query` — if present it silently overrides subscription OAuth and bills API credits. `ANTHROPIC_API_KEY` is currently unset and `~/.claude.json` exists, but **the SDK inheriting OAuth creds from inside the Cursor extension host must be smoke-tested**, not just verified in a terminal. **[S]**
- Provider-selection config `bergamot.llmProvider` (`claude`|`openai`|`vscode`, default `claude`) routed through the single construction point `get_llm_client`. Modify `vscode/package.json`, `config_manager.ts`, `openai_client.ts`, `simple_workflow.ts`. **[M]**
- Make model names provider-neutral (roles `fast`/`smart` instead of hardcoded `gpt-4o-mini`/`gpt-4o`) in `webpage_filter.ts` and `simple_workflow.ts`. **[S]**
- **Embeddings (local model)**: replace `OpenAIEmbeddings` (`vscode/src/workflow/embeddings.ts`) with a local model (all-MiniLM ONNX via Transformers.js) implementing the existing `Embeddings` interface; wire into `database_manager.ts` and `mcp_server_standalone.ts`; decouple the OpenAI key from activation (stop the hard-abort in `extension.ts`). Note: vector dimensionality changes from `text-embedding-3-small` (1536) to the local model — the existing `webpage_memory.db` becomes incompatible, so start a fresh store or re-embed. **[L]**

### Phase E — Trustworthy end-to-end loop

A developer-runnable test exercising the real seam (real extension → discovery → server → DBs → MCP), offline and free.

- Add an LLM injection seam (env `BERGAMOT_LLM=fake` or DI into `build_workflow`/`WebpageWorkflow`) — prerequisite for offline full-pipeline tests, and the same injection point the Claude move uses. **[M]**
- Server-side integration test: real `ServerManager` + real DuckDB/LanceDB on temp paths + fake LLM, POST a real zstd visit, drain the queue, assert DuckDB + LanceDB retrieval (`vscode/src/server/server_pipeline.integration.test.ts`). **[M]**
- Headless standalone server entrypoint `vscode/src/server/server_standalone.ts` (mirrors `mcp_server_standalone.ts`) so the harness can run the server outside the extension host. **[M]**
- On-demand full-pipeline harness `scripts/run-pipeline-e2e.js` + `browser/e2e/full_pipeline.spec.ts` reusing `fixtures.ts` minus `MOCK_PKM_PORT`/mock server; promote the `DEBUG_E2E` SW console hook to an always-on error collector that fails the run. **[L]**

## Key Decisions

1. **Embeddings provider** — DECIDED: local model (all-MiniLM via Transformers.js), true zero-token. Consequence: the existing 1536-dim LanceDB store is incompatible; start fresh or re-embed.
2. **Claude auth verification** — assumes the SDK uses subscription OAuth from `~/.claude.json` with `ANTHROPIC_API_KEY` unset. Must be smoke-tested from inside the Cursor extension host (HOME/keychain inheritance is unverified). Top unknown.
3. **Provider default** — default `bergamot.llmProvider='claude'` once auth verifies.
4. **Brave profile** — persistent dev profile (`~/.bergamot-brave-debug-profile`), its own dir (sharing with Chrome can corrupt it). Brave Shields may block localhost fetches; the dev profile must allow them.
5. **Dev-host vs installed extension collision** — disable/uninstall any published Bergamot VSIX while debugging, or both bind ports 5000–5009 and contend for the single-writer DuckDB.
6. **Production output layout** — dev emits straight to `chrome/dist`; leave the `build:production` packaging path alone for now.
7. **Dev-log gating** — gate `dev-log.jsonl` behind `bergamot.devMode` with a size cap/rotation.

## Risks and Traps

- Using `build:test` for Brave dev pins a random `MOCK_PKM_PORT` and never reaches the real server — the dev script must use plain `build`.
- esbuild watch must emit to `chrome/dist` (what Brave loads); the `copy-dist` step deletes `chrome/dist` each build and can race a concurrent watch — drop the copy in dev.
- MV3 unpacked extensions do not hot-reload; after a rebuild the service worker needs a reload — edits will appear not to work (easy to misdiagnose).
- `tsc -watch` preLaunchTask needs a background `$tsc-watch` problemMatcher or F5 hangs / loads stale `out/`.
- Native deps (`@duckdb/node-api`, `@lancedb/lancedb`) are prebuilt — ABI mismatch vs Cursor's extension-host runtime can fail at DuckDB init; may need a rebuild against the host runtime.
- DuckDB is single-writer: the E2E harness and the running extension host must not open the same DB dir.
- `ANTHROPIC_API_KEY` in the extension-host env silently bills paid credits over the subscription — scrub it from the SDK child env.
- `SERVER_PORT_RANGE` is duplicated in `server_manager.ts` and `server_discovery.ts` with only a comment to keep them in sync — the real-discovery E2E should assert they match.

## Suggested Backlog Tasks

1. Fix Cursor F5 debug config for the monorepo (Phase A).
2. Move/clean the stale OpenAI key in `.vscode/settings.json`; fix config namespace; gitignore `.dev-storage/` (Phase A).
3. Add `BERGAMOT_STORAGE_PATH` dev-storage override for extension + MCP child (Phase B).
4. Add `dev:brave` one-command deploy: Brave path + `BROWSER_BIN` + own profile; esbuild watch to `chrome/dist` (Phase C).
5. Add end-to-end `visit_id` correlation (Phase C).
6. Add structured `dev_log` (output channel + JSONL) + `bergamot.showVisitOutcomes` view (Phase C).
7. Surface browser POST failures via action badge (Phase C).
8. Add `bergamot.replayVisit` + capture persistence (Phase C / E).
9. Add `ClaudeAgentClient` + `bergamot.llmProvider` config (Phase D).
10. Replace OpenAI embeddings with a local model (Phase D).
11. Add LLM injection seam (`BERGAMOT_LLM=fake`) (Phase E, also unblocks D).
12. Add real-DB server pipeline integration test (Phase E).
13. Add headless server entrypoint + full-pipeline E2E harness (Phase E).
