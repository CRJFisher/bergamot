# Decision: Privacy-Core Reorientation — Metadata-Only Capture + Re-Download

**Status:** Accepted
**Date:** 2026-06-08

## Context

Bergamot's original model captured the full page HTML at browse time and stored it losslessly (zstd-compressed) in DuckDB as "the durable source of truth," with sensitivity handled by an ingestion-time denylist plus a post-authentication heuristic gate. That model writes page content — potentially authenticated or sensitive — to disk for every visit, and relies on a heuristic to guess what is sensitive. Heuristic sensitivity detection is not foolproof: some private pages inevitably slip through to durable storage. This is incompatible with privacy being the product's core promise.

## Decision

Privacy is the core organizing principle. The capture mechanism changes:

1. **Capture stores metadata only** — visit id, URL, page-load timestamp, title, and the navigation/session graph. Title, URL, and timestamp come directly from the tab. Page content (HTML/text) is never captured or stored at browse time. **Metadata becomes the durable source of truth.**

2. **Content is acquired by re-download during post-processing** — the page is re-fetched from its stored URL, server-side or on the desktop.

3. **The login wall is the privacy filter.** Authenticated and paywalled pages fail to re-download (login redirect / 403 / paywall) and are thereby excluded automatically. No "is this sensitive?" heuristic and no content denylist are needed — the ingestion-time sensitivity gate is removed. Incognito refusal at capture remains.

4. **Downstream order:** Temporal Topic Detection runs first over the re-downloaded public corpus; RAG-based research tools come after. The clusterable/searchable corpus is the re-downloadable public subset; auth-walled and failed visits remain as trail/metadata only and are excluded from clustering and retrieval.

5. **Any re-downloaded content that is cached is encrypted at rest, scoped, deletable, and quarantined** out of any syncable/git-tracked path. The metadata store is the syncable artifact (over user-owned channels only).

## Considered and rejected

- **Heuristic exclusion + ambient content archiving** (the prior model): rejected — detection is not foolproof, so sensitive pages reach disk.
- **On-demand archiving only via explicit per-page user action:** rejected as the primary mechanism — it adds user friction and still requires deciding what to archive. Re-download with the login-wall filter is automatic and needs no per-page decision. (Explicit per-project caching can still scope what is cached, but the privacy filter is the login wall, not the user.)

## Consequences

- Constitution amended: Capture/Store/Understand intention-tree nodes; Principle 3 (sensitivity exclusion → login-wall-at-re-download); Principles 1, 4, 6, 10; operating policy; scope Now/Later/Never. See [../constitution.md](../constitution.md).
- A new **re-download / post-processing content fetcher** is the keystone upstream dependency of TDT, RAG, and image extraction. It must land with or before the stored-content read path is deleted.
- The capture path is a destructive refactor: browser stops `outerHTML`/zstd; server stops decompress+store; the `content_compressed` BLOB is dropped from DuckDB (clean schema reset, no migration).
- **Trade-off accepted — re-download fidelity:** a re-downloaded page is not guaranteed to equal the as-viewed page (dynamic content, dead links, drift). Citations reference URL/metadata, not a byte-for-byte snapshot.
- New residual surface acknowledged: a stored URL is itself metadata that can leak; governed by the URL-handling policy.

The full repo-wide migration plan: [../../backlog/drafts/privacy-reorientation-plan.md](../../backlog/drafts/privacy-reorientation-plan.md).
