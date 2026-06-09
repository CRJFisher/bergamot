---
id: TASK-39.4
title: At-rest encryption of the metadata store
status: In Progress
assignee:
  - claude
created_date: '2026-06-08 13:30'
updated_date: '2026-06-09 20:05'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write docs/threat-model.md (constitution-named prerequisite): single trusted user, possibly-compromised machine, hostile local processes; state honestly what at-rest encryption does and does not defend.
2. Bump @duckdb/node-api ^1.2.2-alpha.18 → 1.5.3-r.3 (bundles DuckDB ≥ 1.4, native AES encryption); npm install; run jest to verify the data layer passes on the bump alone.
3. duck_db.ts: add `encryption_key` to DuckDBConfig — required for file-backed stores, meaningless for :memory: (in-memory test DBs). init() opens an in-memory instance then `ATTACH '<path>' AS metadata_store (ENCRYPTION_KEY '<key>'[, READ_ONLY])` + `USE metadata_store`, so a file store is only ever created encrypted. No plaintext fallback path exists.
4. New vscode/src/database/encryption_key.ts: get_or_create_metadata_db_key(secrets) — 32 random bytes hex via node:crypto, persisted in VS Code SecretStorage under bergamot.metadata_db_encryption_key. Key loss = data loss (documented; no recovery).
5. Wiring: extension.ts sources the key from context.secrets and passes it to DatabaseManager.initialize_all(storage_path, encryption_key).
6. Tests (colocated): file-backed duck_db tests supply a key; new cases — file-backed without key throws; wrong key fails to open; data persists across close/reopen with the same key.
7. Docs: update backlog/docs/dev-db-reset.md (store is now encrypted; the SecretStorage key survives a reset and that is fine; LanceDB references are stale — prune). Reset is destructive per the no-migration rule; no plaintext→encrypted migration shim.
After implementation: five Fable subagent reviews, apply recommendations, then finalize.
<!-- SECTION:PLAN:END -->
