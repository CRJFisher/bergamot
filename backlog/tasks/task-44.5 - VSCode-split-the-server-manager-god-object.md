---
id: TASK-44.5
title: "VSCode: split the server_manager.ts god object"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - refactor
  - vscode
  - server
dependencies:
  - TASK-44.2
  - TASK-44.3
  - TASK-44.7
references:
  - vscode/src/server/server_manager.ts
  - vscode/src/tdt/rebuild_clusters.ts
  - vscode/src/tdt/cluster_scheduler.ts
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`server/server_manager.ts` is 1,098 lines and owns four functionalities: Express middleware and all route registration, visit-queue wiring, browser-pool / re-download / content-cache coordination, and clustering orchestration (the embed-pass and cluster-run single-flight latches and run wiring). It imports from 20+ modules and is the repo's largest comprehension obstacle. It is a hub by design — the fix is extraction by functionality, not dismantling the hub.

**Scope**

- **Clustering orchestration moves out entirely**: the embed-pass/cluster-run flights and run wiring move to `vscode/src/tdt/` beside `rebuild_clusters.ts` / `cluster_scheduler.ts` (into the folder shape TASK-44.7 settles). The server routes _to_ clustering; it does not own it.
- **Route registration splits by the functional area each route serves** — capture ingestion (`/visit`, dev-signal), content reads, cluster surface — each as a module that registers its routes against the shared Express app. Follow the shape `cluster_routes.test.ts` already implies.
- `server_manager.ts` retains lifecycle: port binding/discovery marker, middleware, wiring the functional route modules and the queue processor, shutdown.
- Depends on TASK-44.2 / TASK-44.3 (the imports it holds move in those tasks — land them first so this diff is not fighting renames) and TASK-44.7.

Extraction is mechanical where possible; no behavior change. The dependency direction stays downward (server → functional modules); no module imports server_manager back.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 No clustering orchestration (flights, run wiring) remains in server_manager; it lives in vscode/src/tdt
- [ ] #2 Route registration lives in per-functionality modules; server_manager holds lifecycle + wiring only
- [ ] #3 server_manager.ts is under ~400 lines
- [ ] #4 Pipeline integration tests (server_pipeline.integration.test.ts, cluster_routes.test.ts) pass unchanged in behavior; tsc and lint clean

<!-- AC:END -->
