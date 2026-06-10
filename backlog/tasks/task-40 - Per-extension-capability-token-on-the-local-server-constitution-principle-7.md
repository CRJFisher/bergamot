---
id: TASK-40
title: Per-extension capability token on the local server (constitution principle 7)
status: To Do
assignee: []
created_date: '2026-06-10 09:57'
labels:
  - security
  - privacy
  - server
dependencies: []
references:
  - vscode/src/server/server_manager.ts
  - vscode/src/mcp_server_standalone.ts
  - browser/src/background.ts
  - docs/threat-model.md
  - docs/constitution.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Constitution principle 7 (inviolable): "The local server requires real authentication. A per-extension capability token, generated at pairing and stored on both sides, is required on /visit and on every /query, and on any re-download or sync endpoint. Loopback binding is a second layer, not the only one. CORS origin-checking is not authentication and is never treated as such." Today the Express server has only CORS origin filtering, and docs/threat-model.md names this as "the largest open gap in the current posture" (adversary B): any local process can read the query API — including re-downloaded page content via /query/capture_content — and inject fake visits via /visit.

APPROACH: generate a random token at first run, hold it in VS Code SecretStorage on the extension side; pair it to the browser extension (cheapest honest pairing for a single trusted user: the server writes a one-time pairing secret the browser fetches on first contact, or the user pastes it once — decide at implementation against the threat model's adversary B, and state what pairing does and does not defend). Require the token on /visit, every /query/*, and /dev_signal; the MCP standalone (which proxies over HTTP) needs it too — it can read it from the port.json sidecar ONLY if that file's exposure is acceptable, otherwise via env from the spawning extension (the spawn already exists in mcp_server_manager.ts). Keep loopback binding as the second layer. Update the threat model's adversary B section from "not yet implemented" to the shipped mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Requests to /visit, every /query/*, and /dev_signal without the per-extension token are rejected; with it they succeed — covered by server tests
- [ ] #2 The token is generated at first run, persisted via SecretStorage on the extension side, and delivered to the browser extension through an explicit pairing step (mechanism and its honest limits documented)
- [ ] #3 The MCP standalone server authenticates to the HTTP API without weakening the scheme (no plaintext token in a world-readable file unless the threat model explicitly accepts it)
- [ ] #4 CORS filtering remains but is not treated as authentication; loopback binding stays as the second layer
- [ ] #5 docs/threat-model.md adversary B reflects the shipped mechanism instead of naming it as the largest open gap
<!-- AC:END -->
