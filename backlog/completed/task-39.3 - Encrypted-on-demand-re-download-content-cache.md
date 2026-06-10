---
id: TASK-39.3
title: Encrypted on-demand re-download content cache
status: Done
assignee:
  - claude
created_date: "2026-06-08 13:30"
updated_date: "2026-06-09 21:15"
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

- [x] #1 Cached re-downloaded content is encrypted at rest with the key held in the OS keystore (VS Code `SecretStorage`); no plaintext page content is written to disk, verified by inspecting on-disk artifacts
- [x] #2 The cache is on-demand and scoped, not populated ambiently
- [x] #3 The cache lives outside any syncable / git-tracked / developer-controlled directory
- [x] #4 Cached items are per-item deletable, exposed for the right-to-forget cascade
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->

Reuse the 39.4-hardened encrypted DuckDB wrapper as a SEPARATE store (separate file + separate SecretStorage key): the metadata store is the syncable artifact (constitution principle 6), so cached content must never live inside it — a second encrypted DuckDB file under the storage base is the cheapest tier that inherits all of 39.4's guarantees (encrypted file + WAL + temp spill, keystore key, no plaintext fallback).

1. duck_db.ts: extract the metadata schema out of init() — init() opens the (encrypted) store only; new exported create_metadata_schema(db) builds tables+indexes. Update callers (database_manager + 4 test files). This makes the wrapper a generic encrypted single-file store usable by both tiers.
2. encryption_key.ts: generalize to get_or_create_store_key(secrets, secret_name, store_file_exists); secret names METADATA_DB_KEY_SECRET and CONTENT_CACHE_KEY_SECRET (separate keys: deleting the cache key destroys only the cache).
3. New vscode/src/redownload/content_cache.ts: CONTENT_CACHE_DB_FILENAME ('content_cache.db' under the storage base — outside any git-tracked/syncable/developer path; dev .dev-storage/ is gitignored); create_content_cache_schema(db); ContentCache with get(page_session_id), put(content, scope), delete_item(page_session_id) (+CHECKPOINT so deletion is flushed), delete_scope(scope). One row per page_session_id; upsert replaces (fresher fetch wins).
4. New CachedCorpus (redownload/cached_corpus.ts): implements ContentCorpus over (db, corpus, cache, scope) — get_content serves a hit from cache, on miss delegates and caches only ok outcomes under the named scope; iter_public_pages walks targets through the same cache-aware read. Population is therefore only ever explicit and scope-named; the live /query/capture_content read path stays uncached (re-downloads live), so nothing is populated ambiently.
5. No activation wiring: the tier's consumers are the 39.5 forget cascade (next task, wired immediately) and TDT (task-36.3). open path = DuckDB({database_path, encryption_key}) + create_content_cache_schema.
6. Tests (colocated): content_cache.test.ts — real-file encryption canary (file + WAL) with the page content as marker, roundtrip, upsert, per-item delete (re-read misses), scope delete; cached_corpus.test.ts — fake fetcher counts fetches (second read = 0 fetches), exclusions not cached, scope recorded.
7. Docs: storage.html content-cache card (tier now exists: file, separate key, location); dev-db-reset.md stores list + reset command; threat-model.md asset/defense updates (cache built; same at-rest property); stale "task-39.3" forward references in corpus.ts/duck_db.ts/page-processing.html updated to point at the real tier.
After implementation: five Fable subagent reviews, apply recommendations, then finalize.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->

Implemented in 94e8c57 (feature) + 3573ab1 (five-lens review fixes).

Review process: five parallel Fable subagent reviews (correctness, security, architecture/constitution, test quality, docs/product truth). Decisive findings applied: (1) open_content_cache() canonical factory — two reviewers independently flagged that the hand-rolled open recipe let a consumer pair the wrong existence check with the key lookup and silently re-key (brick) an existing cache; (2) the delete_item JSDoc's block-reclamation claim was empirically FALSE (a security reviewer proved freed ciphertext blocks are never reclaimed by subsequent checkpoints — the file even grows on partial delete; only emptying the store truncates) — docs and threat model now state the residue honestly, and the 39.5 cascade must account for it; (3) CachedCorpus served cached content for deleted metadata rows — now checks row existence on every read and purges stale rows; (4) three vacuous tests fixed (conditionally-skipped WAL scan, no unencrypted control in the cache table's shape, deleted-means-gone asserted by scanning an encrypted file) — deletion is now verified by reopen+miss+row-count; (5) delete_by_url added (the one selector the cache serves natively; justifies the url index; cleanup for orphaned rows); (6) shared iter_public_pages_via() deduplicates the corpus-pass policy; (7) corpus/cached-corpus logging drops URLs (extension-host console persists to plaintext logs); (8) scope semantics documented and tested: newest WRITER owns the row, hits do not re-attribute, delete_scope is best-effort eviction not right-to-forget; (9) doc sweep — README cascade over-claim fixed, CLAUDE.md/constitution intention-tree status updated, storage.html gained the webpage_fetch entity, quarantine claims softened to "encryption, not location, is load-bearing".

Deferred to 39.5 (recorded constraints): batch delete_items(ids) with a single CHECKPOINT (per-item delete pays one WAL flush each); the cascade must resolve cache rows from metadata BEFORE deleting metadata rows (or use delete_by_url for orphans); the cascade should account for freed-block ciphertext residue (delete-all truncates; consider compaction for partial forgets of high-sensitivity items).

Verification: tsc clean, eslint clean, 254/254 jest (cache suite 3x, no flakes), full-pipeline e2e green.

<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->

The encrypted on-demand content cache exists as its own tier: content_cache.db, a second encrypted DuckDB store under the storage base, reusing the 39.4-hardened wrapper (encrypted file + WAL + temp spill, no plaintext path) with its own SecretStorage key (bergamot.content_cache_encryption_key) so destroying the cache key forfeits only the cache. The canonical open path is open_content_cache(secrets, storage_base), which makes the existing-store re-key guard structurally un-skippable. Population is never ambient: CachedCorpus — an opt-in, scope-named wrapper over the live re-download corpus — is the only write path; it caches only ok outcomes, re-classifies exclusions on every read, verifies the metadata row still exists before serving a hit (and purges stale rows), and the default /query/capture_content read path still re-downloads live. ContentCache exposes get/put plus the forget primitives the 39.5 cascade calls: delete_item, delete_by_url, delete_scope (best-effort eviction; newest writer owns a row's scope). Deletion semantics are documented honestly: deletes are checkpointed out of the WAL and live table immediately; freed-block ciphertext can persist inside the encrypted file until reused (unreadable without the key; emptying the store truncates). Encryption and deletion are pinned by real-file tests with an unencrypted control in the cache table's exact shape, WAL scans, reopen-based deletion verification, and factory open/reopen/missing-key tests. 254 jest tests + full-pipeline e2e green.

<!-- SECTION:FINAL_SUMMARY:END -->
