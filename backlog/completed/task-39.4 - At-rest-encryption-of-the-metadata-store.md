---
id: TASK-39.4
title: At-rest encryption of the metadata store
status: Done
assignee:
  - claude
created_date: "2026-06-08 13:30"
updated_date: "2026-06-09 20:44"
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

- [x] #1 The DuckDB metadata store is opened with an `ENCRYPTION_KEY` sourced from the OS keystore (VS Code `SecretStorage`)
- [x] #2 `@duckdb/node-api` is on a version supporting native database encryption (DuckDB ≥ 1.4.0); the data layer passes its regression tests after the bump
- [x] #3 A random data-encryption key is generated at first run and stored in `SecretStorage`; key loss is documented as data loss with no plaintext fallback
- [x] #4 The store is created encrypted (no plaintext-to-encrypted migration shim)
- [x] #5 The threat-model doc is written and committed
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->

Implemented in cd1b467 (feature) + d48e6b9 (five-lens review fixes).

Review process: five parallel Fable subagent reviews (correctness, security/crypto, architecture/constitution, test quality, docs/product truth). Applied: temp-spill-file encryption + pinned temp_directory (two reviewers independently reproduced plaintext spill files — the decisive finding); instance close-on-close (WAL checkpointed away) and init-failure cleanup; existing-store guard + persistence verification in the key provider (a transient SecretStorage read failure can no longer silently re-key and brick the store); 64-hex key validation in the DuckDB constructor; dead MCP STORAGE_PATH/storage_base plumbing deleted; test scaffolding de-mocked (real tmp dirs), WAL canary scan + unencrypted control + checkpoint-on-close + quoted-path escaping tests; threat-model honesty fixes (visit-inbox/dev-log plaintext side-channels named, Linux no-keyring degradation, env-key e2e exception, indicator/pause marked not-yet-implemented); README purged of LanceDB/semantic_search and now documents key-loss = data-loss.

Declined (with rationale): making the StoreTarget union the public constructor contract / factory methods — the runtime invariant is enforced at the innermost seam and pinned by tests; the refactor would churn five files for no behavioral gain (cheapest-change rule).

Accepted gap: crash-recovery (encrypted WAL replay after a hard process exit) has no automated test — it requires a spawned child process. A reviewer verified the behavior manually: the WAL replays correctly on next ATTACH with the same key, and a stale WAL next to a deleted store file is tolerated.

Follow-ups surfaced for triage (not ticketed): (1) visit inbox buffers visits as plaintext JSON before the DuckDB write — named in docs/threat-model.md as an open gap; candidate subtask under task-39. (2) Stale LanceDB-as-current-system claims remain in backlog/docs/mcp-rag-architecture.md, local-dev-loop-plan.md, mcp-tools-usage.md, query-interface.md — candidate doc-prune task.

Verification: tsc clean, eslint clean, 234/234 jest tests (encryption block run 3x, no flakiness), full-pipeline e2e green against the encrypted store. Dev store reset performed per backlog/docs/dev-db-reset.md (coordinated once with the 39.1 schema reset, as the task required).

<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->

The DuckDB metadata store is now encrypted at rest. @duckdb/node-api moved to 1.5.3-r.3 (bundles DuckDB ≥ 1.4 native AES encryption); a file-backed store is only ever created encrypted — the wrapper opens an in-memory instance and ATTACHes the file with ENCRYPTION_KEY, refuses keyless file stores, requires a 64-hex-char key, encrypts temp spill files, and pins the spill directory next to the store. The data-encryption key is 32 random bytes generated on first run and held via VS Code SecretStorage (OS keystore); a fresh key is minted only when no store file exists, so a transient keystore failure cannot silently re-key and brick an existing store. Key loss is data loss by design — no plaintext fallback, no escrow. The headless e2e server takes a per-run throwaway key via STORAGE_ENCRYPTION_KEY. The dead read_only config option and the MCP child's unused STORAGE_PATH plumbing were deleted. docs/threat-model.md (the constitution-named prerequisite) is committed, including honest statements of what at-rest encryption does not defend (hostile same-user processes; the plaintext visit-inbox buffer; Linux-no-keyring degradation). Encryption is pinned by real-file tests: round-trip reopen, wrong-key rejection, WAL + file canary scans with an unencrypted control, checkpoint-on-close, and SQL-literal escaping. 234 jest tests + full-pipeline e2e green.

<!-- SECTION:FINAL_SUMMARY:END -->
