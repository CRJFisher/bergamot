---
id: TASK-39.5
title: >-
  Cascading right-to-forget across metadata, content cache, vectors, and
  clusters
status: In Progress
assignee:
  - claude
created_date: '2026-06-08 13:30'
updated_date: '2026-06-09 21:16'
labels:
  - privacy
  - storage
dependencies:
  - TASK-39.3
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - docs/constitution.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the constitution's inviolable right-to-forget (principle 4) as a core-spine primitive. Deleting — by URL, by origin, or by time-range — atomically removes the metadata row(s) AND every derived artifact: the encrypted re-download content cache (task-39.3), derived vectors, and cluster memberships.

Forgetting is deletion, not hiding: no derived artifact may continue to encode forgotten content. The operation is atomic across the cascade (a partial delete that leaves vectors or cache entries behind is a failure). Coordinates with the TDT (task-36) and RAG (task-31) derived stores as those land — the cascade must cover whatever derived stores exist.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Delete-by-URL, delete-by-origin, and delete-by-time-range are available
- [ ] #2 A delete atomically removes the metadata row(s), the encrypted content-cache entries, derived vectors, and cluster memberships
- [ ] #3 Deletion is real, not a tombstone — verified that no derived artifact still encodes the forgotten content
- [ ] #4 The cascade is covered by tests across all derived stores that exist
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
The derived stores that exist today are the metadata tables (webpage_trees / webpage_activity_sessions / webpage_capture / webpage_fetch) and the encrypted content cache (39.3). Vectors and clusters (task-36/31) do not exist yet; the cascade module is the single place they join when they land (documented in its header). 39.3's recorded constraints honored: resolve targets from metadata BEFORE deleting metadata; batch cache deletes with one CHECKPOINT; delete_by_url cleans orphans.

1. ContentCache.delete_items(page_session_ids) — batch form, single CHECKPOINT; delete_item delegates to it.
2. New vscode/src/right_to_forget.ts:
   - ForgetSelector = {kind:'url',url} | {kind:'origin',origin} | {kind:'time_range',from,to} (ISO, inclusive).
   - resolve: page_session_ids + urls from webpage_capture and webpage_activity_sessions (origin matched by URL.origin parsing in TS; time-range on page_loaded_at/captured_at).
   - forget(metadata_db, content_cache | null, selector): cascade order = content cache first (delete_items + delete_by_url for each url), then ONE metadata transaction: DELETE webpage_fetch (by id, url, final_url), webpage_capture, webpage_activity_sessions; scrub surviving rows' referrer/referrer_page_session_id that encode forgotten urls/ids (origin-forget also prefix-scrubs truncated referrers); DELETE trees with no remaining sessions. Returns a ForgetReport (counts).
   - Atomicity, honestly: per-store deletes are transactional; cross-store atomicity over two database files is not possible, so the cascade orders derived-content-first and is idempotent — a partial failure can only leave metadata without content (the safe direction), and a re-run completes it. Documented in the module header and the task notes.
3. User-facing surface: `bergamot.forget` command (package.json + CommandManager): quick-pick URL / origin / time-range, explicit modal confirmation, opens the content cache via open_content_cache only when the cache file exists (forgetting must not create a cache), runs forget, reports counts.
4. Tests (colocated right_to_forget.test.ts): seed visits across urls/origins/times in in-memory metadata + cache; forget by each selector; assert capture/session/fetch rows gone, cache rows gone, empty trees removed, surviving referrer fields scrubbed, unrelated rows intact; idempotent re-run; null-cache path; one real-file test (encrypted metadata + cache files, forget by url, reopen both, verify durably gone — AC#3's "no artifact still encodes the content").
5. Docs: README right-to-forget bullet states the shipped cascade (metadata + content cache; vectors/clusters join as they land); threat-model standing-decisions line updated to present tense; cascade ordering + residue note stays in content_cache.ts.
After implementation: five Fable subagent reviews, apply recommendations, then finalize.
<!-- SECTION:PLAN:END -->
