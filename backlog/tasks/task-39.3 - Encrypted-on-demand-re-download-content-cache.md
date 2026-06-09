---
id: TASK-39.3
title: Encrypted on-demand re-download content cache
status: In Progress
assignee:
  - claude
created_date: '2026-06-08 13:30'
updated_date: '2026-06-09 20:47'
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
