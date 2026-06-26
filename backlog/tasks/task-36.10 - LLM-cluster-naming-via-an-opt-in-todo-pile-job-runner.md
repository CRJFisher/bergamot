---
id: TASK-36.10
title: LLM cluster naming via an opt-in todo-pile job runner
status: To Do
assignee: []
created_date: '2026-06-26 12:37'
labels: []
dependencies:
  - TASK-36.5
  - TASK-36.6
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
  - tdt/src/labeling/llm_naming_seam.ts
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give topic clusters an optional, LLM-rewritten display name, and ship the reusable opt-in job mechanism that makes such expensive, networked work safe to defer. Two coupled pieces: a standalone todo-pile job runner (the wrapper) and the LLM-naming job (the first plug-in).

**The todo-pile job runner (standalone, job-agnostic).** Work that must NOT run on the automatic capture/clustering path — because it is expensive, hits the network, or calls an LLM — is appended to a durable "todo pile": a file in a known state location holding typed job entries (job kind, payload, enqueued-at, dedupe key). A SessionStart hook reads the pile at the start of a session and surfaces the pending jobs to the user, who chooses to run, skip, or defer each. Running a job dispatches to the handler registered for its kind; success clears the entry, failure leaves it for a later session. The module owns the pile format and location, enqueue/dedupe/dequeue, the hook registration, and the job-kind->handler registry — nothing about it is LLM- or TDT-specific, so any feature (a heavy re-cluster, a backfill, a re-embed pass) can enqueue a kind and register a handler. This keeps the passive product path offline, deterministic, and zero-LLM (the privacy core), while still making deferred work discoverable and one-click runnable, with the user always in control of when — and whether — it runs.

**The LLM-naming job (plugs into the runner).** This implements the ClusterNamer seam left by task-36.5 (tdt/src/labeling/llm_naming_seam.ts): a pure rewrite step that consumes the deterministic ClusterLabel evidence bundle (headline_title, scope, keyphrases) and returns one clean human phrase that replaces display_label — no new signal, just a rewrite. It is gated by a config flag introduced WITH this code (task-36.5 deliberately shipped no dead default-off flag), and cached on the geometric + stable-core ClusterFingerprint (re-fire only when the representative vector moves beyond a cosine threshold OR the stable core's Jaccard overlap drops below ~0.8), never on exemplar-id hashes. A completed clustering run ENQUEUES an LLM-naming job rather than running it inline; the rewrite happens only when the user runs it from the pile. The LLM call sends only the deterministic label bundle — titles, domains, and keyphrases already in the metadata DB, never page content — but it does leave the machine if a remote provider is configured, so the provider is the user's explicit choice (a local model is preferred, to honor the privacy core) and nothing is sent without an explicit run.

**Sequencing.** A durable cross-window LLM-name cache and lifeline-level labeling want stable cluster identity, which arrives with the Phase-4 tracking slice (plan §7) — not part of this micro-tier chain. Until then the job rewrites at per-run cluster granularity, keyed by the fingerprint; the cross-window cache table lands with tracking. This keeps the task shippable at the end of the task-36 chain without blocking on Phase 4.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §7 ("LLM naming — SEAM ONLY"); the seam being implemented is tdt/src/labeling/llm_naming_seam.ts (ClusterNamer, ClusterFingerprint).

Open questions: which session boundary hosts the hook (a Claude Code SessionStart hook vs the VS Code extension's activation-time check, mirroring task-36.9's scheduler) and where the runner module lives (a bergamot-wide vscode/ module, since hooks/UI are extension concerns, with the pure rewrite contract staying in tdt/); the LLM provider/runtime (local vs remote) and its config surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A standalone, job-agnostic todo-pile module owns a durable job pile (typed entries with a dedupe key), enqueue/dequeue, and a job-kind->handler registry; the pile survives restarts
- [ ] #2 A SessionStart hook reads the pile and surfaces pending jobs, letting the user run, skip, or defer each; running dispatches to the registered handler, success clears the entry and failure leaves it for a later session
- [ ] #3 An LLM-naming job plugs into the runner and implements the ClusterNamer seam — rewriting the deterministic ClusterLabel bundle into one display phrase via the configured LLM, leaving the other label fields unchanged
- [ ] #4 The LLM path is gated by a config flag introduced with this code (no pre-shipped dead flag), and is cached on the geometric + stable-core ClusterFingerprint (representative-vector cosine move OR stable-core Jaccard), not exemplar-id hashes
- [ ] #5 A completed clustering run enqueues an LLM-naming job rather than running it inline; capture and clustering stay zero-LLM and offline, and the LLM runs only on explicit user opt-in from the pile
- [ ] #6 The LLM call sends only the deterministic label bundle (no page content); the provider is user-configured with a local-model option, and nothing is sent without an explicit run
- [ ] #7 The cross-window LLM-name cache and lifeline-level labeling are documented as deferred to the tracking slice; the v1 job rewrites at per-run cluster granularity
<!-- AC:END -->
