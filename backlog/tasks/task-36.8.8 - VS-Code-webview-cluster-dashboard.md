---
id: TASK-36.8.8
title: VS Code webview cluster dashboard (optional accessory)
status: To Do
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.8.2
  - TASK-36.8.7
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The optional rich-visibility accessory for the VS Code host — a net-new WebviewView/Panel:
timeline + cluster cards + member drill-down + domain scope, consuming the read primitive
via `port.json` + token-authed fetch in the extension host, `postMessage` to a sandboxed
CSP/nonce webview; a `viewsContainers` entry + a `bergamot.openClusters` command +
opens-on-launch activation. It is the literal "VS Code panel that opens on launch" (§3) for
VS Code users, and may host the control affordances from TASK-36.8.7 as one-click card
buttons — a richer host for them, never their only route.

**Explicitly NOT v1.** It is host-locked (serves Wave 1 only), the highest build +
maintenance cost, and does not port to the daemon future — so it is off the launch critical
path. Build it after the backbone + skill + control route prove the loop. Resist scope
creep: no PKM-write affordances from card clicks (any note write goes only to staging).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A WebviewView/Panel rendering timeline + cluster cards + member drill-down from the read routes, opening on launch
- [ ] #2 Consumes the primitive via `port.json` + token-authed fetch in the host; sandboxed CSP/nonce webview; the panel never opens DuckDB
- [ ] #3 Optionally exposes suppress/rename/never-cluster-origin as card actions over the existing control route — never the sole route to them
- [ ] #4 No PKM-write affordances from card clicks; any note write goes only to `bergamot.staging/`

<!-- AC:END -->
