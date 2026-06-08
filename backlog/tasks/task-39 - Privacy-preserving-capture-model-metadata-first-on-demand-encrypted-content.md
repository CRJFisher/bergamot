---
id: TASK-39
title: >-
  Privacy-core capture model: metadata-only capture + re-download (login wall as
  the privacy filter)
status: To Do
assignee: []
created_date: "2026-06-08 12:10"
labels:
  - privacy
  - security
  - capture
  - architecture
dependencies: []
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - docs/decisions/privacy-core-reorientation.md
  - backlog/drafts/privacy-reorientation-plan.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Umbrella task for bergamot's privacy-core capture model. Privacy is the product's core organizing principle: capture stores **browsing metadata only** (visit id, URL, page-load timestamp, title, navigation/session graph) — never page content — and that metadata is the durable source of truth. Page **content** is obtained later by **re-downloading the public URL** during post-processing, where the **login wall is the privacy filter**: authenticated/paywalled pages fail to re-download and are excluded automatically. Any cached re-downloaded content is encrypted, on-demand, scoped, and deletable.

Canonical model: backlog/drafts/privacy-preserving-capture-model.md. Decision: docs/decisions/privacy-core-reorientation.md. The docs are already reoriented; this task covers the CODE and SCHEMA changes that honor the model. Constitution rule applies: destructive schema reset, no backwards-compat shims.

The work is decomposed into subtasks:

- **39.1** — Stop ambient content capture + metadata-only DuckDB schema reset (browser + server + schema + tests).
- **39.2** — Re-download / post-processing content fetcher + content read path (the keystone; login-wall filter; fidelity metadata).
- **39.3** — Encrypted on-demand re-download content cache.
- **39.4** — At-rest encryption of the metadata store (the source of truth).
- **39.5** — Cascading right-to-forget across metadata, content cache, vectors, and clusters.

Build order: **39.2 lands with or before 39.1** (the stored-content read path must be repointed at re-download before the stored content is dropped, or `get_webpage_content` returns nothing). 39.3 depends on 39.2; 39.5 depends on 39.3; 39.4 coordinates with 39.1's schema reset.

OUT OF SCOPE (tracked under their own parents): the downstream RAG (task-31) and TDT (task-36) rescopes to the re-downloaded public corpus. This task records that contract; the rescopes are edits to task-31/36.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Capture writes browsing metadata only; browsing without any explicit action produces zero stored page content (delivered by 39.1)
- [ ] #2 Page content is obtained by re-downloading public URLs in post-processing; authenticated/paywalled pages fail and are excluded — the login wall is the privacy filter (39.2)
- [ ] #3 Any cached re-downloaded content is encrypted at rest, scoped, and deletable (39.3)
- [ ] #4 The metadata store (the durable source of truth) is encrypted at rest (39.4)
- [ ] #5 Right-to-forget cascades atomically across metadata, content cache, vectors, and clusters (39.5)
- [ ] #6 The privacy model docs (privacy-preserving-capture-model.md, constitution) remain canonical and in sync with what ships
- [ ] #7 The downstream contract (RAG/TDT corpus = the re-downloadable public subset; auth-walled visits are trail/metadata only) is recorded, and the task-31/task-36 rescopes are tracked under those parents
<!-- AC:END -->
