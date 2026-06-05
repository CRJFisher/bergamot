---
id: TASK-36.8
title: MCP surface for topic clusters
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.6
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Expose detected clusters read-only through the MCP server, mirroring the existing five deterministic tools verbatim (stdio relays to the extension's HTTP /query routes; results are JSON text). Add three tools — list*topic_clusters(from, to, limit), get_topic_cluster(id), list_clusters_for_page(page_session_id) — backed by new read-only /query/topic*_ routes that are single-DuckDB JOINs over the topic\__ and webpage\_\* tables, clamped by the existing query limit. Also add a /query/visits_in_window route to serve TDT's own windowed Stage-1 fetch, with a row cap that accommodates a full window.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §9 (MCP surface).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 list_topic_clusters, get_topic_cluster, and list_clusters_for_page are added to the standalone MCP server, return JSON in the same shape as the existing tools, are read-only, and are limit-clamped
- [ ] #2 Backing /query/topic*\* routes are single-DuckDB JOINs over topic*_ and webpage\__ tables, and a /query/visits_in_window route serves the windowed fetch with a cap accommodating a full window
- [ ] #3 get_topic_cluster orders member pages by membership probability descending; list_clusters_for_page returns empty for a page that was clustered as a one-off (noise)
- [ ] #4 Tests cover each tool and its backing route
<!-- AC:END -->
