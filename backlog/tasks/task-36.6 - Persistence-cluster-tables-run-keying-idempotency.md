---
id: TASK-36.6
title: "Persistence: cluster tables, run keying, idempotency"
status: Done
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-26 00:00"
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

- [x] #1 topic_run, topic_cluster, topic_cluster_member, and topic_page_vector tables are created by the extension's writer, and TDT reads/writes honor the DuckDB single-writer model
- [x] #2 run_id is a hash of (window bounds, params_hash, embedding_model_id, algo_version); re-running the same key with an unchanged input_fingerprint is a no-op
- [x] #3 A changed input_fingerprint does an atomic replace and a changed model/params/algo supersedes the prior run; input_fingerprint detects re-embedding and late-arriving visits in a closed window
- [x] #4 Noise is persisted via a non-null is_noise flag and per-window coverage (clustered/total) is queryable from the cluster tables alone
- [x] #5 Tests cover no-op, atomic-replace, supersede, and the coverage query
<!-- AC:END -->

## Implementation Notes

### High-level summary

This slice gives the TDT micro tier a durable, reproducible home for its output. Clustering is a pure, fit-only computation: re-running the same window must be byte-stable, and re-running it after the data drifts must replace the old result rather than accrete a second one. That reproducibility contract is what this slice persists — a clustering **run** is the unit of identity, and the rules for when a run is reused, replaced, or retired are the heart of the work.

The design splits along the package seam the TDT plan fixes (§3): identity and record assembly are **pure** (`@bergamot/tdt`), and the transactional write is the **extension's single DuckDB writer**. [run_keying.ts](../../tdt/src/run_keying.ts) computes three independent hashes — `run_id` (the natural key: window bounds + params_hash + embedding_model_id + algo_version), `params_hash` (canonical sorted-key JSON of the HDBSCAN params, windowing policy, pooling strategy, and matryoshka dim — everything that rewrites inputs but is invisible in the other key columns), and `input_fingerprint` (the sorted page/vector-version pairs that detect re-embedding and late-arriving visits). [persist.ts](../../tdt/src/persist.ts) assembles the clustering output into `topic_run` / `topic_cluster` / `topic_cluster_member` rows, emitting one member row per page — clustered **and** noise — so coverage is derivable from the cluster tables alone. [cluster_store.ts](../../vscode/src/tdt/cluster_store.ts) owns the idempotent transaction: it reads the existing run, then in one transaction does **no-op** (same key, unchanged fingerprint), **atomic replace** (same key, changed fingerprint), or **create + supersede** (a new key retires the prior live run for the window).

To navigate: start at `run_keying.ts` for the identity contract, then `assemble_run_bundle` for the row mapping, then `ClusterStore.persist` for the state machine. The schema lives in [duck_db.ts](../../vscode/src/duck_db.ts) `create_metadata_schema`; the `ClusterSink` port in [ports.ts](../../tdt/src/ports.ts) is the seam between them.

### Decisions

- **Soft references, not foreign keys, with explicit ordered deletes.** DuckDB rejects `ON DELETE CASCADE` outright (parser error) and cannot delete a foreign-key parent and child in one transaction — both verified empirically against `@duckdb/node-api` before committing the schema. Either limitation would make the atomic-replace path (delete members→clusters→run, repopulate, all in one transaction) impossible. The three TDT tables therefore use plain `TEXT` soft refs, matching every other table in the metadata store; referential integrity is upheld by `ClusterStore.persist`, which always writes and deletes a run's three tables together in one transaction.
- **The idempotency decision lives in the sink, not the pure library.** No-op/replace/supersede depends on current on-disk state (does a complete run with this id exist? does its fingerprint match?), which the pure library never sees. The library hands over a fully-keyed `RunBundle`; the sink reads, decides, and writes atomically. This kept the `ClusterSink` port a single `persist(bundle)` method (the three granular `write_*` methods could not express the read-decide-write unit) and kept the race-free read on the extension's single writer.
- **`run_id` keys off canonicalized window bounds.** The bounds are normalized to one ISO form (`canonical_timestamp`) both where `run_id` is hashed and where the row is stored, so a differently-spelled-but-equivalent bound can never make the supersede equality predicate miss the prior run.
- **Noise is a non-null `is_noise` flag, never a NULL `cluster_id` sentinel.** This keeps the `cluster_id` foreign key strictly meaningful (set iff clustered) and makes coverage a plain `COUNT(*) FILTER (WHERE NOT is_noise) / COUNT(*)` with no NULL-aware SQL.
- **`status='complete'` is written directly; `'running'`/`'failed'` are a forward seam.** v1 persists a finished result in one transaction, so there is no observable in-progress state. The two unused status values (and the nullable counts that pair with `'running'`) are reserved for the TASK-36.9 orchestrator's two-phase / crash-recording lifecycle. A `force` recompute flag is deliberately not built — the `input_fingerprint` already drives every required replace, and no acceptance criterion needs it (YAGNI).
- **Right-to-forget deletes a forgotten page's cluster memberships, not its clusters/runs.** The per-page embedding (`topic_page_vector`, the reconstructable artifact) is deleted; a cluster's frozen `representative_vector` is an irreversible aggregate and a run is window-level provenance. The retained cluster may briefly reference a forgotten exemplar or overstate its size until the next run re-keys the window (its `input_fingerprint` changes) and atomically replaces it — a bounded, non-reconstructable residual, documented honestly in the module header.

### Verification

`@bergamot/tdt`: 179 unit tests pass (1 todo), both `tsc` configs clean. New coverage: run-keying determinism (canonical JSON key-order/float/`-0` invariance, non-finite + non-plain-object fail-loud guards, `undefined`-key omission, timestamp normalization, per-key change detection, fingerprint order-independence + re-embed/late-visit/drop-out detection, distinct cluster ids), bitwise-stable **golden digests** for `run_id`/`params_hash`/`input_fingerprint` (a regression fence against silent canonical-form drift on a persisted cache key), and the assembler (exemplar resolution, one member per page, noise rows, counts, `is_exemplar`, injected-clock determinism, fail-loud guards). `vscode`: full suite green (334 tests). New `cluster_store.test.ts` exercises schema creation, FLOAT[]/TEXT[]/empty-keyphrases round-trips, no-op, atomic-replace (incl. created_at preservation and the late-visit fingerprint path), supersede (history retained, one live run per window), the natural-key UNIQUE guard, the assemble→persist supersede seam end-to-end, and the coverage query; `right_to_forget.test.ts` gains the cluster-membership cascade case.
