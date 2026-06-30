---
id: TASK-36.9
title: Trigger and off-thread orchestration
status: Done
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-23 03:45"
labels: []
dependencies:
  - TASK-36.4
  - TASK-36.6
  - TASK-36.7
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Wire the end-to-end run behind two entry surfaces over one pure rebuild_clusters(window_spec) module function: a manual VS Code command (on-demand and for testing) and an automatic scheduled trigger (the passive-product path — Bergamot surfaces projects without the user remembering to run anything). Keep the heavy compute off the extension-host event loop so a multi-second clustering run never freezes the UI or stalls the /visit capture endpoint: both the network re-download and the O(n^2) HDBSCAN fit run in a worker thread or child process (mirroring the existing MCP-server spawn pattern); the worker returns raw results and the extension's single DuckDB writer persists them in one short transaction.

The automatic trigger is an in-host scheduler (a VS Code extension timer / activation-time check), not an OS cron + headless writer — a headless writer would violate the single-writer model (plan §3). The cadence is configurable; its default is an evidence-based judgement made from task-36.7's output (the live visits-per-month distribution and the measured per-run re-download volume), defaulting to once/day until that data narrows it. A single-flight guard prevents duplicate concurrent runs across multiple workspace windows and reloads. Cost on quiet days is bounded by §8 idempotency: a run over an unchanged window (same input_fingerprint) is a no-op, so a daily tick that finds no new visits costs ~nothing. Count-based triggers ("fire after N visits") are out of scope — the count guard is a windowing quality invariant (task-36.2), not a trigger — as is OS cron.

This orchestration adapter also owns two input-path hooks left by TASK-36.8: it adds the
`GET /query/visits_in_window?from=&to=` Stage-1 bulk read that feeds clustering (preserved in
plan §9, not yet in server_manager.ts), and it applies the user's `never-cluster-origin`
preferences — read via `ClusterControlStore.list_never_cluster_origins()` — to exclude those
registrable domains from the clustering input (and from the skip-re-download list), satisfying
constitution §3's "never-cluster-this-origin feeds the capture/skip-re-download list."

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §11 step 9; cadence evidence from task-36.7; cost model in plan §8; the §8.8 control hooks from TASK-36.8 (backlog/decisions/0001-tdt-cluster-surface.md).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A bergamot.tdt.rebuildClusters command invokes a pure rebuild_clusters(window_spec) function
- [ ] #2 Both the re-download (network) and the HDBSCAN fit (CPU) run off the extension-host event loop (worker thread or child process), and the /visit capture endpoint plus the UI stay responsive during a run
- [ ] #3 Results are persisted by the extension's single DuckDB writer in one short transaction
- [ ] #4 An end-to-end test or documented manual verification clusters a real month and browses the result via the MCP surface without blocking capture
- [ ] #5 An automatic in-host trigger fires rebuild_clusters on a configurable cadence (default once/day, the value justified by the task-36.7 evidence), with a single-flight guard that prevents duplicate concurrent runs across windows and reloads
- [ ] #6 A scheduled run over an unchanged window performs no re-download and no re-fit (the §8 idempotency no-op), verified by a test
- [ ] #7 The `GET /query/visits_in_window?from=&to=` Stage-1 bulk read (plan §9) is added, row-capped to a full window, feeding the clustering input
- [ ] #8 `never-cluster-origin` controls (TASK-36.8) exclude their registrable domains from the clustering input and the skip-re-download list, via `list_never_cluster_origins()`
<!-- AC:END -->

## Implementation Notes

### High-level summary

The clustering run is wired behind one orchestrator, `rebuild_clusters(deps, spec)`
(`vscode/src/tdt/rebuild_clusters.ts`), reached by two entry surfaces: the manual
`bergamot.tdt.rebuildClusters` command and an automatic in-host scheduler
(`cluster_scheduler.ts`, default once/day). Both call the same dependency-injected
module function, so on-demand and passive paths share one code path and one
single-flight guard.

A run vectorises the re-downloadable public corpus ahead of clustering, reads the
window's visits over the Stage-1 broker, excludes the user's never-cluster
origins, windows the range (calendar months + count-guarded subdivision,
TASK-36.2), and for each window dispatches the heavy compute off the
extension-host event loop before persisting through the single DuckDB writer. The
pure compute — the dense `O(n²)` cosine build, the HDBSCAN fit, the
representations, and the deterministic labeler — is composed in
`@bergamot/tdt`'s `compute_clusters` (`tdt/src/cluster_pipeline.ts`) and run in a
forked child process (`cluster_worker.ts`, driven by `cluster_worker_client.ts`),
mirroring the MCP-server spawn pattern. The worker takes page vectors + visits in
and returns run-local labels/representations out; it never touches the
single-writer database, so the extension's `ClusterStore` persists the result in
one short transaction.

### How the acceptance criteria are addressed

- **#1** — `bergamot.tdt.rebuildClusters` (registered in `command_manager.ts`,
  declared in `package.json`) invokes the pure `rebuild_clusters(deps, spec)`
  orchestrator, which imports no vscode / DuckDB / clustering-tfjs values.
- **#2** — The HDBSCAN fit + `O(n²)` build run literally off-thread, in the forked
  worker (a multi-second fit never blocks the UI or `/visit`). The network
  re-download + the CPU embed run off the event loop inside the existing batched
  embed pass (`embed_pass.ts`): ONNX inference executes on libuv's threadpool, the
  fetch is async I/O, and a `setImmediate` yield between pages keeps capture
  interleaving. Re-download is **not** moved into a separate process because a
  worker cannot hold the single-writer DuckDB it must read the corpus and write
  the vector store through (plan §3); off-the-event-loop is satisfied without it.
- **#3** — `ClusterStore.persist` does the read-decide-write (no-op / atomic
  replace / supersede) in one `isolated_transaction`; the worker holds no DB
  handle.
- **#4** — `rebuild_clusters.integration.test.ts` clusters a seeded real month
  through the real orchestrator → real HDBSCAN → real `ClusterStore.persist`, then
  browses the result back through the `list_clusters_in_range` surface; a second
  run asserts the idempotent no-op.
- **#5** — `ClusterScheduler` fires the run on `bergamot.tdt.clusterCadenceHours`
  (default 24, `0` disables); it re-arms only after each tick settles (no
  self-overlap) and shares the server's `cluster_run_flight` single-flight with
  the manual command. Cross-window/process duplication is caught by the
  single-writer DB + §8 idempotency.
- **#6** — Before dispatching the worker, the orchestrator computes the window's
  `input_fingerprint` and probes the live run's fingerprint
  (`ClusterStore.live_run_fingerprint`); on a match it returns `unchanged` with no
  re-fit and no persist (the §6 memoization). Verified by both the unit test and
  the end-to-end second-run test.
- **#7** — `GET /query/visits_in_window?from=&to=&limit=` is added in
  `server_manager.ts` over `list_visits_in_window` (`visit_reads.ts`), capped at
  `MAX_VISITS_IN_WINDOW`. The cap sits **above** `max_samples` deliberately: a
  heavy month must be read in full so windowing can subdivide it; capping at
  `max_samples` would drop the very pages subdivision exists to separate. A
  cap-hit is logged as a possible truncation (no silent loss).
- **#8** — `list_never_cluster_origins()` feeds both the clustering input filter
  (`getDomain`-matched, in the orchestrator) and the re-download skip: the corpus
  drops blocked targets BEFORE `get_content`, so a never-cluster origin is never
  re-fetched or vectorised (constitution §3). The embed pass and the manual embed
  command apply the same exclusion regardless of entry point.

### Notable decisions

- **Worker vs in-host for the fit.** A forked child process (not a worker thread)
  mirrors the two existing spawn precedents (MCP server, browser provisioner) and
  gives the native TensorFlow backend a clean process; IPC uses
  `serialization: 'advanced'` so `Float32Array` vectors cross intact.
- **Packaging.** The whole TensorFlow chain (`@tensorflow/tfjs`,
  `@tensorflow/tfjs-core`, `@tensorflow/tfjs-node`) plus `clustering-tfjs` are
  bundle externals — `cluster_window.ts` statically imports `tfjs-core`, so
  without this esbuild inlines a second copy into the worker bundle (breaking the
  externals guard and splitting TensorFlow's process-global backend registry).
- **Memoization key.** The live-run probe matches on
  `(window, params_hash, embedding_model_id)` but not `algo_version`, which the
  host cannot resolve without loading TensorFlow. A pure backend change therefore
  re-clusters a window only when its inputs next change — an accepted, documented
  limitation; the supersede invariant still guarantees exactly one live run per
  window.

### Status: Done
