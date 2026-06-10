# Amendment: the re-downloaded content cache is default-populated, not on-demand

**What changes:** Constitution Section 1 (the STORE node of the spine) and Section 3 ("Retention is two-tiered"). The content cache, previously described as **on-demand** (populated only when a consumer explicitly opted in under a named scope), is now **default-populated**: the capture server opens the encrypted cache at start and wraps the default content read path so every successful public re-download persists under a `"default"` scope as it is served. Scoped consumers (a TDT run, a research project) still cache under their own scope.

**Why:** The hero loop (re-download → understand → surface) and the MCP `get_webpage_content` tool repeatedly read the same public pages. Re-downloading live on every read is slow, impolite to remote hosts, and wasteful when the metadata record already pins the URL. Persisting the extracted main-content markdown by default turns the cache into the working set for Temporal Topic Detection and RAG without each consumer having to opt in.

**What does NOT change — the inviolables hold:** The cache remains a separate, **encrypted** DuckDB store with its own OS-keystore key; **quarantined** outside the syncable metadata artifact and the PKM repo; **deletable** through the right-to-forget cascade (principle 4); and **never the source of truth** — the metadata record is canonical and the cache is rebuildable by re-download. No Section 2 inviolable is relaxed, so this is an operating-policy amendment (Section 7), not an inviolable amendment.

**Retention of the `"default"` scope:** currently forever, bounded only by the right-to-forget cascade. Section 3 still permits a shorter or ephemeral retention per scope; a sweep/eviction policy for the `"default"` scope is deferred until cache size proves to be a real problem.

**Storage shape:** the cached body is the extracted main-content markdown (task-31.5), stored brotli-compressed as a BLOB (zlib brotli is built into the Node 20 extension host; zstd is not). `content_hash` stays the SHA-256 of the rendered HTML the markdown was extracted from — a fetch-fidelity marker, not a hash of the stored body.

**Authored by:** the user (who directed this change), 2026-06-10, reviewing the task-39.10 finalization. Implementation: `vscode/src/server/server_manager.ts` (default-path wrapping), `vscode/src/redownload/cached_corpus.ts` and `content_cache.ts` (population + compression); the intention tree in `CLAUDE.md` is updated to match.
