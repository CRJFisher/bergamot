---
id: TASK-39.4
title: "At-rest encryption of the metadata store"
status: To Do
assignee: []
created_date: "2026-06-08 13:30"
labels:
  - security
  - storage
  - privacy
dependencies: []
references:
  - backlog/drafts/privacy-preserving-capture-model.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Encrypt the DuckDB metadata store at rest. Metadata is now the durable source of truth, so this is a tracked near-term commitment, not optional polish.

APPROACH: use DuckDB native database encryption — bump `@duckdb/node-api` from the 1.2.x line to a release that bundles DuckDB ≥ 1.4.0 (where database encryption landed) — and open the store with an `ENCRYPTION_KEY` sourced from the OS keystore via VS Code `SecretStorage` (`context.secrets`). Generate a random data-encryption key at first run and store it in `SecretStorage`; if the key is lost the store is unrecoverable (no plaintext fallback) — document this.

Per the no-migration rule, create the store encrypted rather than migrating a plaintext store. Coordinate with task-39.1's schema reset so the store is reset once, encrypted.

PREREQUISITE: write the threat-model doc the constitution names (single trusted user, possibly-compromised machine, hostile local processes). At-rest encryption defends offline/physical/file-level and some malware compromise; it does not defend a hostile process running as the user while unlocked — state this honestly.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 The DuckDB metadata store is opened with an `ENCRYPTION_KEY` sourced from the OS keystore (VS Code `SecretStorage`)
- [ ] #2 `@duckdb/node-api` is on a version supporting native database encryption (DuckDB ≥ 1.4.0); the data layer passes its regression tests after the bump
- [ ] #3 A random data-encryption key is generated at first run and stored in `SecretStorage`; key loss is documented as data loss with no plaintext fallback
- [ ] #4 The store is created encrypted (no plaintext-to-encrypted migration shim)
- [ ] #5 The threat-model doc is written and committed
<!-- AC:END -->
