---
id: TASK-39.3
title: "Encrypted on-demand re-download content cache"
status: To Do
assignee: []
created_date: "2026-06-08 13:30"
labels:
  - security
  - storage
  - privacy
dependencies:
  - TASK-39.2
references:
  - backlog/drafts/privacy-preserving-capture-model.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

When re-downloaded content is cached (for TDT/RAG or a research project), store it as a separate, encrypted, on-demand tier — never plaintext page content on disk, and never the source of truth.

- **Encrypted at rest** with an OS-keystore-backed key (VS Code `SecretStorage`); the key is not stored alongside the data.
- **On-demand and scoped** (e.g. to a research project / the active corpus), not ambient.
- **Quarantined** out of any syncable or git-tracked directory and any developer-controlled path (constitution principle 6).
- **Per-item deletable**, integrating with the right-to-forget cascade (task-39.5).

Caches the output of the re-download fetcher (task-39.2).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Cached re-downloaded content is encrypted at rest with the key held in the OS keystore (VS Code `SecretStorage`); no plaintext page content is written to disk, verified by inspecting on-disk artifacts
- [ ] #2 The cache is on-demand and scoped, not populated ambiently
- [ ] #3 The cache lives outside any syncable / git-tracked / developer-controlled directory
- [ ] #4 Cached items are per-item deletable, exposed for the right-to-forget cascade
<!-- AC:END -->
