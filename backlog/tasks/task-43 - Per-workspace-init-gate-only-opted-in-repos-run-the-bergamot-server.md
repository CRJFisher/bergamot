---
id: TASK-43
title: Per-workspace init gate — only opted-in repos run the bergamot server
status: To Do
assignee: []
created_date: "2026-07-03"
labels:
  - vscode
  - activation
  - onboarding
dependencies: []
references:
  - vscode/package.json
  - vscode/src/extension.ts
  - vscode/src/commands/command_manager.ts
  - vscode/src/config/config_manager.ts
  - vscode/src/config/storage_path.ts
  - vscode/src/server/server_manager.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The extension activates on `onStartupFinished` and unconditionally starts the local HTTP server that consumes browsing data (`vscode/src/extension.ts`). A user typically runs several VSCode instances at once, only one of which is their PKM repo. Today every window with Bergamot installed spins up the full stack — server, encrypted stores, cluster scheduler — and multiple instances would contend for the server port and the shared storage. The server must only run for workspaces that have explicitly opted in.

**Intent-tree node:** STORE/CAPTURE plumbing — the local server is the single consumer of browsing metadata; it should exist once, in the workspace the user designated, not ambiently in every window.

### `Bergamot: Init` command

A one-time command the user runs in the workspace they want to activate. It performs all first-run initialisation:

1. **Browser extension install** — install the browser extension automatically via the Chrome API if a programmatic path exists (investigate: Chrome removed inline/external install for most cases, so the realistic fallback is opening the Web Store listing, or for dev builds pointing the user at `chrome://extensions` load-unpacked with the built `browser/` output). The command should do the best automated thing available and clearly instruct for the rest.
2. **Workspace activation artifact** — create a durable marker the extension checks at activation time to decide whether this workspace runs the server. Decide the artifact's form during implementation: a checked-in file (e.g. `.bergamot/` or a key in workspace settings) makes the opt-in travel with the repo across machines; workspace-scoped `Memento`/globalState keyed by workspace keeps it out of the repo. Prefer the checked-in form — the PKM repo _is_ the thing being activated.
3. **Remaining first-run provisioning** — anything else that currently happens lazily or at activation and belongs at init instead: embedding model download (bge-small via transformers.js, per the TDT page-vector decision), headless re-download browser provisioning (task-39.6 territory), storage/key bootstrap.

### Activation gate

- On `activate()`, check for the artifact **before** constructing `DatabaseManager`/`ServerManager`/`ClusterScheduler`. Absent artifact → register only the `Bergamot: Init` command and return; the window carries no Bergamot runtime cost.
- Commands, tree views, and hover providers that presuppose a running server are only registered in activated workspaces.
- Two simultaneously open activated workspaces is a user error the extension should surface, not silently race on the port: if the server port is already bound by another Bergamot instance, show a clear message naming the conflict rather than failing opaquely.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 In a workspace without the activation artifact, the extension registers only the init command — no server, no database open, no cluster scheduler — verified by test
- [ ] #2 Running `Bergamot: Init` creates the activation artifact, and a reload of that workspace starts the full stack
- [ ] #3 Init installs the browser extension via the most automated path Chrome permits, and gives explicit instructions for any manual remainder
- [ ] #4 Init performs remaining one-time provisioning (embedding model download and any other deferred first-run setup) with visible progress
- [ ] #5 A second activated workspace opening while the server port is bound surfaces a clear "Bergamot is already running in another window" message instead of an opaque bind error

<!-- AC:END -->
