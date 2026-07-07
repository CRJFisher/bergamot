---
id: TASK-44.1
title: "Browser: dissolve core/ and types/ into functional modules"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - browser
dependencies: []
references:
  - browser/src/core
  - browser/src/types/navigation.ts
  - browser/src/background.ts
  - browser/src/content.ts
  - browser/tests
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The browser extension's entire body (everything except the two entry points) lives inside `browser/src/core/` — a layer folder holding eight unrelated concerns — and `browser/src/types/navigation.ts` bundles four types that each belong to a different functional area (`TabHistory` → session graph, `VisitData` → capture, `PKMConfig` → configuration, `ReferrerInfo` → visit enrichment).

**Scope**

Dissolve both folders into functionality-named modules. Target shape (executor may adjust names, not the principle):

- `session_graph/` — `tab_history_manager.ts`, `tab_history_persistence.ts`, and the `TabHistory` / `ReferrerInfo` types.
- `capture/` — `data_collector.ts`, the `VisitData` type, the content-script config loader (`configuration_manager.ts` + `PKMConfig` — its only consumer is the content script), and the send/retry logic currently inline in `content.ts` if extracting it keeps the diff small.
- `server_transport/` — `api_client.ts`, `server_discovery.ts`, plus `post_with_rediscovery` and the discovery-cache/badge logic extracted from `message_router.ts`.
- Dev-signal functionality unified in one place: `core/dev_signal.ts` (content-side relay) and `forward_dev_signal` inside `message_router.ts` are the same feature split across two homes.
- `message_router.ts` slims to pure dispatch: route by action, delegate to the functional modules above. Session enrichment (`enrich_visit_with_session`, `handle_get_referrer`) moves with the session-graph/enrichment functionality.

`background.ts` and `content.ts` stay as entry points with imports updated. Tests in `browser/tests/` are renamed to track their subjects. Renames via `git mv`; no aliases or re-exports.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 browser/src/core/ and browser/src/types/ no longer exist; every module lives in a functionality-named location
- [ ] #2 Each of the four types from types/navigation.ts is colocated with the module that owns it
- [ ] #3 message_router contains dispatch only — no enrichment, transport-caching, or dev-signal logic
- [ ] #4 Dev-signal relay + forwarding live in one functional home
- [ ] #5 All browser tests pass; tsc and lint clean; diff is rename + mechanical extraction only (no behavior change)

<!-- AC:END -->
