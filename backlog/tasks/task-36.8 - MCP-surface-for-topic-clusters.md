---
id: TASK-36.8
title: Decide the user-facing surface for topic clusters (UI investigation)
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-22 11:30"
labels: []
dependencies:
  - TASK-36.5
  - TASK-36.6
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
  - backlog/drafts/deploy-to-pkm-platforms.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Decide how detected topic clusters are surfaced to the user. This is an investigation-and-decision task, not a fixed implementation. Clustering produces cluster + label-bundle data (persisted by 36.6, labeled by 36.5); the right user-facing surface for that data is an open design question that this task resolves and decomposes into follow-on implementation sub-tasks.

**Reject the raw-MCP-tools pattern as the primary surface.** Exposing read-only query tools over the cluster tables makes the DB shape the UX: a low-level primitive with no curation that gives the user poor visibility into what they have actually been browsing. The prior scope of this task (three `list_topic_clusters` / `get_topic_cluster` / `list_clusters_for_page` MCP tools over `/query/topic_*` routes) is retired.

**Split the two concerns the old scope conflated:**

- **The integration primitive** — one thin, host-agnostic read API over the cluster + label-bundle tables (the label bundle from 36.5: `headline_title`, `scope`, `keyphrases`, `display_label`, representative page, `representation_version`). This is the *only* layer that touches the DB. Its natural home is the standalone Bergamot daemon that `backlog/drafts/deploy-to-pkm-platforms.md` extracts. Every surface below is a *consumer* of this one primitive, so surfaces can ship independently and per-host.

- **The user-facing surface(s)** — the actual UX. Candidates to evaluate, not assume:
  - **Skill / sub-agent over scripts** — a Claude skill that runs custom scripts (fetch recent clusters, summarise a cluster, draft a note stub) invoked during PKM tasks. Strong in-workflow actionability; weak passive visibility (the user must ask). Matches the preferred Bergamot integration pattern and is host-agnostic.
  - **VS Code webview** (a standalone package) — a visual dashboard of recently-browsed topics: timeline, cluster cards, member pages, domain scope. Strong ambient visibility; higher build/maintenance cost and VS-Code-host-specific, in tension with the host-portability vision in `deploy-to-pkm-platforms.md`.
  - **Note-stub write-back** — clusters become staged note stubs in the user's own PKM, written ONLY into a quarantined `bergamot.staging/` directory, never into canonical user notes (constitution principle 8). The most PKM-native surface and the SURFACE-node hero loop; the careful piece.

These surfaces **layer**, they are not mutually exclusive. The likely shape — to be confirmed by this task — is: note-stub write-back as the PKM-native backbone, a skill as the in-workflow actionability layer that also *drives* stub generation, and a webview as an optional rich-visibility accessory for the VS Code host.

The task evaluates the candidates against named criteria — PKM-native visibility, in-workflow actionability, host portability, implementation cost, privacy — enumerates the concrete PKM workflows each chosen surface supports (e.g. weekly review, note seeding / Maps-of-Content, in-context recall while writing, dormant-thread resurfacing, cluster-boundary curation), defines the integration-primitive contract, and decomposes the decision into follow-on implementation sub-tasks.

Output is a decision record (ADR) under `backlog/` plus spun-off implementation sub-tasks — not a shipped UI.

Design reference: `backlog/drafts/tdt-hdbscan-micro-tier-plan.md` §9 (surfacing) and `backlog/drafts/deploy-to-pkm-platforms.md` (host portability and note-stub write-back).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A decision record (ADR) under `backlog/` evaluates the candidate surfaces (skill/sub-agent over scripts, VS Code webview, note-stub write-back) against PKM-native visibility, in-workflow actionability, host portability, implementation cost, and privacy, and recommends a layering rather than a single winner
- [ ] #2 The ADR defines the integration-primitive contract: a thin, host-agnostic read API over the cluster + 36.5 label-bundle tables that every surface consumes, with its relationship to the planned standalone daemon documented; the raw-MCP-tools scope is explicitly retired with no half-built `/query/topic_*` routes left behind
- [ ] #3 The ADR enumerates the concrete PKM workflows the chosen surface(s) support and maps each workflow to a surface
- [ ] #4 The chosen surface(s) respect constitution principle 8 (note write-back goes only to `bergamot.staging/`, never canonical notes) and the metadata / encrypted-store invariants, recorded in the ADR; whether the surface is read-only or read-write (cluster-boundary curation as feedback signal) is decided, not left implicit
- [ ] #5 The decision is decomposed into follow-on implementation sub-tasks (the integration primitive plus each accepted surface), each admissible against the intention tree

<!-- AC:END -->
