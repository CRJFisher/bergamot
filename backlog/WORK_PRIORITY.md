# Work Priority

## Current Status

Bergamot is mid **privacy-core reorientation**: capture is metadata-only, content is re-downloaded from public URLs in post-processing, and the login wall is the privacy filter. Canonical references: [docs/constitution.md](../docs/constitution.md), [CLAUDE.md](../CLAUDE.md), [docs/decisions/privacy-core-reorientation.md](../docs/decisions/privacy-core-reorientation.md), and the migration plan [drafts/privacy-reorientation-plan.md](drafts/privacy-reorientation-plan.md).

Docs are reoriented and the backlog is rescoped. What follows is the logical build order.

## Critical path

The keystone is **TASK-39.2** (the re-download fetcher): it is the upstream dependency of every content consumer (TDT, RAG, image extraction). Nothing that needs page content can proceed until it exists. The shortest path to the hero loop is **39.2 → 39.1 → TDT (task-36) → PKM write-back**.

The mobile work is an independent track that can run in parallel once task-39 is settled.

---

## Phase 0 — Privacy-core capture & storage foundation (task-39) · HIGH

The data-model reorientation; everything else builds on it. Status: 39.1–39.6 shipped; 39.7 remains.

1. **TASK-39.2** — Re-download fetcher + content read path — _keystone; build first; unblocks all content work_
2. **TASK-39.1** — Stop ambient content capture + metadata-only schema reset — _after 39.2's read-path swap_
3. **TASK-39.4** — At-rest encryption of the metadata store — _parallel; coordinate with 39.1's reset_
4. **TASK-39.3** — Encrypted on-demand content cache — _after 39.2_
5. **TASK-39.5** — Cascading right-to-forget — _after 39.3; extends as derived stores land_
6. **TASK-39.6** — Provision the re-download headless browser for a packaged install — _shipped; the packaged extension provisions Chromium on first fetch_
7. **TASK-39.7** — Surface Linux keyring degradation of SecretStorage-backed store keys — _runtime signal for the threat-model gap; macOS/Windows need nothing_
8. **TASK-39.8** — Close the plaintext visit-inbox gap — _the encrypted store's front door is still plaintext; the threat model's biggest at-rest side-channel_
9. **TASK-39.9** — Bound the dev-observability plaintext side-channels (dev-log + replay ring) — _dev-only, default-off; forget should delete the dev log wholesale_
10. **TASK-40** — Per-extension capability token on the local server — _constitution principle 7 (inviolable); the threat model's largest open gap against hostile local processes_

- **TASK-34** (empty/degraded-content handling) folds into TASK-39.2's fetch-outcome classifier.
- **TASK-39.6** also resolved the shared native-dep packaging gap (workspace hoisting hid runtime deps from vsce; see docs/decisions/native-dep-packaging.md).

## Phase 1 — Content quality over the re-downloaded corpus

Improves the text fed to embeddings; serves both TDT and RAG. Depends on TASK-39.2. Enhancers, not hard blockers — TDT can start on raw re-downloaded text, but clean extraction meaningfully improves embedding quality, so prefer landing these before TASK-36.3.

- **TASK-31.5** — Clean ingestion: main-content extraction
- **TASK-32** — LLM-gated image/diagram extraction

## Phase 2 — Hero loop: Temporal Topic Detection (task-36)

The constitution's critical path — surface the projects the user is actually working on. Runs first over the re-downloaded public corpus; depends on TASK-39.2.

1. **TASK-36.1** — Scaffold `@bergamot/tdt` package
2. **TASK-36.2** — Windowing & data-scale resolution
3. **TASK-36.3** — Page vectorisation (re-downloaded pages)
4. **TASK-36.4** — Cosine matrix + HDBSCAN clustering core
5. **TASK-36.5** — Cluster representations + deterministic labeler
6. **TASK-36.6** — Persistence (cluster tables, run keying, idempotency)
7. **TASK-36.7** — Validation harness + parameter sweep
8. **TASK-36.8** — MCP surface for topic clusters
9. **TASK-36.9** — Trigger + off-thread orchestration

- Then **PKM write-back** (surfaced project → editable note stub) and the **habit-anchor push surface** (VS Code panel / weekly notification) — constitution Scope-Now items, not yet ticketed; create when reached. These complete the hero loop.

## Phase 3 — RAG research tools (task-31) · deferred branch, eval-gated

Unlocks only after TDT proves value and the eval harness validates a retrieval baseline (constitution deferred branch b). Each technique below is built **only if TASK-31.1 shows a metric gap it closes** — RAG complexity is eval-driven, not reference-architecture-driven.

1. **TASK-31.1** — RAG evaluation harness — _gates everything below_
2. **TASK-31.6** — Embedding model evaluation/selection
3. **TASK-31.3** — Chunking + contextual retrieval + parent-document
4. **TASK-31.2** — Hybrid search (dense + BM25 via RRF)
5. **TASK-31.4** — Reranking over hybrid candidates
6. **TASK-31.8** — MCP generation surface (citations, ordering, short-circuit)
7. **TASK-31.7** — Query transformation (HyDE / multi-query) — _optional_
8. **TASK-31.11** — Time-aware retrieval
9. **TASK-31.10** — Per-role model overrides (Haiku default)
10. **TASK-31.9** — Decision record: defer advanced architectures
11. **TASK-31.12** — Scheduled "topic digest" skill — _RAG use-case_

## Phase 4 — Query interface & hardening

- **TASK-29** — SQL-like query interface for the browsing database
- **TASK-33** — Harden browser dev-signal instrumentation (strict-CSP E2E + dev-mode gating)
- **TASK-22** — Categorization eval — _re-scope: evaluates the re-download content-processing step, if still needed_
- **TASK-18.8** — Performance optimization

## Parallel track — Mobile (deferred)

Independent of the hero loop; can proceed once the privacy model (task-39) is settled. Mobile is "Later" per the constitution.

- **TASK-37** — Sync transport (user-owned device sync) — _depends on task-39_
- **TASK-38** — Mobile capture (Android + iOS) — _depends on TASK-37 + task-39_

## Phase 5 — Release

- **TASK-24** — Marketing materials for the VS Code marketplace
- **TASK-25** — Documentation overhaul

---

## Dependency map (key edges)

- **TASK-39.2** (fetcher) → blocks TASK-39.1, TASK-39.3, TASK-31.5, TASK-32, TASK-34, and TASK-36 (via 36.3) — i.e. all content work
- TASK-39.3 → TASK-39.5
- **task-36 (TDT)** depends on TASK-39.2, and is itself the **unlock condition for task-31 (RAG)**
- **task-37** depends on task-39; **task-38** depends on TASK-37 + task-39
