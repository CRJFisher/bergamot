---
id: TASK-36.8.5
title: The bergamot-clusters skill
status: Done
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.8.1
  - TASK-36.8.2
  - TASK-36.8.7
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
  - backlog/tasks/task-31.12 - RAG-use-case-scheduled-topic-digest-Claude-skill-over-visited-pages.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The host-agnostic actionability layer: a Claude skill (SKILL.md + dependency-free Node
scripts) over the cluster read routes, doing no DB access of its own — it discovers the
server via `~/.bergamot/port.json` and hits the loopback routes exactly like
`mcp_server_standalone.ts`. It answers in-context recall, drives the hero loop
(`summarise → draft stub` via `POST /stage_cluster`), and is the host-agnostic home for the
launch-blocking curation actions (suppress / rename / never-cluster-origin via the control
routes). Cluster ids dangle across recomputes, so the skill resolves clusters by current
window each invocation and never caches an id. Token-ready (attaches a Bearer token if
`port.json` carries one) but not token-dependent.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 SKILL.md (frontmatter + workflows) under `.claude/skills/bergamot-clusters/`, mirroring the drift-sync convention
- [x] #2 Scripts hit the loopback routes only (no DB access); shared `port.json` discovery helper
- [x] #3 The hero loop (`cluster` → `stub`) and the curation actions wired to the routes
- [x] #4 Resolves ids per-invocation; token-ready but not token-dependent

<!-- AC:END -->

## Implementation Notes

### High-level summary

The version-controlled source lives at `skills/bergamot-clusters/` (`.claude/` is
gitignored repo-wide; see `skills/README.md`) and is installed into
`.claude/skills/bergamot-clusters/` to run — this repo symlinks it. It holds `SKILL.md`
plus `scripts/port_discovery.js` (the shared relay) and `scripts/bergamot_clusters.js` (a
dependency-free dispatcher with
`recent` / `page` / `cluster` / `coverage` / `stub` / `suppress` / `rename` / `block` /
`unblock` / `unsuppress` / `unrename`). `stub` triggers the extension's staging writer via
`POST /stage_cluster` so idempotency / the forget sweep / the ledger stay in one place. The
weekly digest cadence is TASK-36.8.6.
