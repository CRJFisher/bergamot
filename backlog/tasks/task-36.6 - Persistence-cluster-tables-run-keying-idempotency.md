---
id: TASK-36.6
title: "Persistence: cluster tables, run keying, idempotency"
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.4
  - TASK-36.5
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Persist runs, clusters, and members to new DuckDB tables in the existing capture database file, written ONLY by the extension's single writer (DuckDB is single-writer per file; TDT compute hands results back and the extension persists them). Tables: topic_run, topic_cluster, topic_cluster_member, and the topic_page_vector cache.

A run is the unit of reproducibility, keyed by a hash of (window bounds, params_hash, embedding_model_id, algo_version). Re-running the same key with the same input_fingerprint is a no-op; a changed fingerprint (re-embedding, or a late-arriving visit landing in a closed window) triggers an atomic replace; a changed model/params/algo supersedes the prior run (one live run per window, history retained). Noise is persisted explicitly via a non-null is_noise flag (no NULL cluster_id sentinel) so coverage = clustered/total is derivable from the cluster tables alone.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §8 (Persistence).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 topic_run, topic_cluster, topic_cluster_member, and topic_page_vector tables are created by the extension's writer, and TDT reads/writes honor the DuckDB single-writer model
- [ ] #2 run_id is a hash of (window bounds, params_hash, embedding_model_id, algo_version); re-running the same key with an unchanged input_fingerprint is a no-op
- [ ] #3 A changed input_fingerprint does an atomic replace and a changed model/params/algo supersedes the prior run; input_fingerprint detects re-embedding and late-arriving visits in a closed window
- [ ] #4 Noise is persisted via a non-null is_noise flag and per-window coverage (clustered/total) is queryable from the cluster tables alone
- [ ] #5 Tests cover no-op, atomic-replace, supersede, and the coverage query
<!-- AC:END -->
