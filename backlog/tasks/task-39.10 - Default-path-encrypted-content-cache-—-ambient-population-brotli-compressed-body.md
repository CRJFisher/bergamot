---
id: TASK-39.10
title: >-
  Default-path encrypted content cache — ambient population + brotli-compressed
  body
status: Done
assignee: []
created_date: '2026-06-10 15:18'
updated_date: '2026-06-10 16:32'
labels:
  - privacy
  - store
dependencies:
  - TASK-31.5
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evolve the encrypted content cache (task-39.3) from an opt-in, scope-named tier into the default persistence for re-downloaded public content, and store the page body compressed.

Today the encrypted `ContentCache` is populated ONLY by opt-in scoped consumers wrapping the live corpus in a `CachedCorpus`; the default read path `/query/capture_content` re-downloads live and caches nothing. This task makes the default path persist every ok re-download into the encrypted cache under a `"default"` scope: the server opens the cache at start (threading `vscode.SecretStorage` + storage base into `ServerConfig`) and wraps the live corpus in `CachedCorpus`. The cache stays encrypted (own store + own keystore key), deletable via the right-to-forget cascade (task-39.5), and is NEVER the source of truth — the metadata record remains canonical.

The cached page body (the extracted main-content markdown produced by task-31.5) is stored brotli-compressed as a BLOB (`zlib.brotliCompressSync`/`brotliDecompressSync`, built into the Node 20 extension host — zstd is unavailable there). `content_hash` stays the SHA-256 of the rendered HTML (fetch fidelity), independent of the stored compressed markdown.

This revises the documented constitutional description of the cache from "on-demand / scoped" to "default-populated" in CLAUDE.md and docs/constitution.md (user-authored amendment).

Lifecycle constraints: DuckDB attaches a file from one instance at a time, so the server-owned cache handle must be reused by the forget command (which otherwise opens its own and deadlocks on the file lock). The headless standalone (no SecretStorage) and tests (injected corpus) bypass the cache wiring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The default content read path (/query/capture_content) persists every ok re-download into the encrypted content cache under scope "default"; auth/paywall/dead/non-HTML pages are never cached
- [x] #2 The cached page body is stored brotli-compressed as a BLOB and round-trips back to the identical markdown string on read; a redundant body is measurably smaller than its UTF-8 length
- [x] #3 The forget command reuses the server-owned cache handle (no DuckDB multi-instance file-lock conflict); the headless standalone and corpus-injecting tests bypass cache wiring
- [x] #4 CLAUDE.md and docs/constitution.md describe the cache as default-populated (encrypted, deletable, not source of truth)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The encrypted content cache is now the default persistence for re-downloaded public content. The capture server opens the cache during `prepare()` (when `vscode.SecretStorage` + a storage base are present and no corpus is injected) and wraps the live re-download corpus in a `CachedCorpus` under the `"default"` scope, so every successful public re-download persists as it is served on `/query/capture_content` (and to TDT/RAG). The cache stays encrypted (own store + own keystore key), quarantined, deletable via the right-to-forget cascade, and never the source of truth — the metadata record is canonical and the cache is rebuildable by re-download.

The cached body (the extracted main-content markdown from task-31.5, or raw HTML when extraction degrades) is stored as a brotli-compressed BLOB — `zlib` brotli at quality 5 with a size hint, built into the Node 20 extension host (zstd is not), kept off the slow path since compression runs synchronously per put. `content_hash` stays the SHA-256 of the rendered HTML, independent of the stored body.

Lifecycle and safety, hardened during review: the forget command reuses the server-owned cache handle (`get_content_cache()`) and opens its own only when the server holds none — DuckDB attaches a file from one instance at a time, so a second open would deadlock; per-read cache failures degrade to the live corpus instead of failing the request; an ok page is re-checked against its metadata row before caching, closing a window where an in-flight read could re-cache content a concurrent forget just removed; `open_content_cache` and a failed `start()` release the handle so the file lock cannot leak; `stop()` closes the HTTP server before the cache. The headless standalone (no SecretStorage) and corpus-injecting tests bypass caching.

The constitution is amended to describe the cache as default-populated (docs/decisions/default-path-content-cache.md; Section 1 STORE node + Section 3 retention bullet updated), and CLAUDE.md matches. Tests: `server_manager_content_cache.test.ts` (default-path caching, second-read cache hit with no re-fetch, exclusions uncached, bypass paths), `content_cache.test.ts` (brotli BLOB round-trip + size, at-rest plaintext-scan), `command_manager_forget.test.ts` (handle reuse vs. own-handle close).
<!-- SECTION:FINAL_SUMMARY:END -->
