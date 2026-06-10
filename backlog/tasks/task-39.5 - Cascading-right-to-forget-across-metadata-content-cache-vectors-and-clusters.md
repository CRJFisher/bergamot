---
id: TASK-39.5
title: >-
  Cascading right-to-forget across metadata, content cache, vectors, and
  clusters
status: Done
assignee:
  - claude
created_date: '2026-06-08 13:30'
updated_date: '2026-06-10 09:46'
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
- [x] #1 Delete-by-URL, delete-by-origin, and delete-by-time-range are available
- [x] #2 A delete atomically removes the metadata row(s), the encrypted content-cache entries, derived vectors, and cluster memberships
- [x] #3 Deletion is real, not a tombstone — verified that no derived artifact still encodes the forgotten content
- [x] #4 The cascade is covered by tests across all derived stores that exist
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in 63f6343 (feature) + 6b2db01 (five-lens review fixes).

Review process: five parallel Fable subagent reviews (correctness, privacy-completeness, architecture/constitution, test quality, docs/product truth). The decisive findings, all applied: (1) CRITICAL — url/origin forgets dead-ended when metadata resolution was empty (orphan fetch rows and cache content survived while the command reported "nothing matched"); the resolver now matches the fetch log directly by url and post-redirect final_url (extending only the URL sweep — a redirecting visit's own session survives), the selector's URL always joins the sweep, and origin forgets sweep cache rows via delete_by_origin. (2) CRITICAL — plaintext visit-inbox files survived a forget and resurrected the forgotten rows on restart via reload_persisted_visits; the cascade now sweeps matching visit_inbox/ and captures/ (replay ring) files, the live queue and orphan manager are purged before the cascade, and the in-memory outcome ring is purged. (3) Time-range matching was lexicographic string comparison — millisecond-precision rows in the boundary second and offset-bearing bounds were silently missed; now epoch comparison, with validated/normalized command input. (4) The metadata transaction ran on the shared live-writer connection (a concurrent visit could be destroyed by ROLLBACK — verified empirically by a reviewer); now a dedicated connection via DuckDB.isolated_transaction, plus a cutoff-guarded tree sweep that runs on every forget (a reviewer proved with a red test that the old "re-run completes it" claim was false). (5) Tests added for every load-bearing claim: rollback, cache-first ordering, partial-state re-run, tree-sweep recovery, redirect fetch rows, orphan rows, origin edges (port/scheme/malformed), union/ms-timestamp resolution, file sweep — 21 cascade tests, 275 total.

AC#2 deliberately left unchecked pending a user decision: constitution principle 4 says "atomically removes"; the implementation is per-store transactional + derived-content-first + idempotent across stores (cross-store atomicity over separate database files is not possible). The deviation is documented honestly in the module header and threat model, but per the constitution's own Section 7, reconciling the principle's wording is a user-authored amendment — proposed wording: "atomic per store; across stores, ordered derived-content-first and idempotent, so no derived artifact can survive its metadata." Vectors/clusters do not exist yet; task-31 AC#9 and task-36 AC#7 now anchor their joining the cascade in vscode/src/right_to_forget.ts.

Known accepted bounds (documented in threat-model.md and the module header): dev-log.jsonl is never rewritten; plaintext buffer files that existed before a forget remain forensically recoverable after unlinking; freed-block ciphertext persists inside the encrypted stores until reused; a visit arriving concurrently with a forget can land after the referrer scrub (the queue purge closes most of that window).

Verification: tsc clean, eslint clean, 275/275 jest, full-pipeline e2e green.

2026-06-10: the user authored the principle-4 amendment (docs/decisions/principle-4-per-store-atomicity.md) — deletion is atomic per store, ordered derived-content-first and idempotent across stores. The constitution wording and the shipped semantics now agree, so AC#2 is checked: the cascade removes metadata, content-cache entries, and (vacuously, until they exist) vectors and cluster memberships under the amended atomicity definition.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The cascading right-to-forget primitive (constitution principle 4) is live, surfaced as the `Bergamot: Forget` command. Forgetting by URL, by origin (URL.origin equality, not prefix matching), or by time range (inclusive, epoch-compared) removes: the metadata rows (capture, activity sessions), the fetch log — matched by session id, stored URL, and post-redirect final_url, so a forgotten URL reached via someone else's redirect is also erased; the encrypted content-cache entries (by id batch, by URL, and by origin for rows no metadata row carries); the plaintext visit-inbox and dev-replay buffer files under the storage base (closing the restart-resurrection path); the in-memory outcome ring; and referrer fields on surviving visits that encode the forgotten pages. Navigation trees left empty are removed by an always-run, cutoff-guarded sweep. The live queue and orphan manager are purged before the cascade runs. The metadata deletes run in one transaction on a dedicated connection so the live visit writer can never join or be rolled back with a forget; the cascade is derived-content-first and idempotent across stores, and the command validates timestamp input, confirms via modal, opens the cache only if it exists, and surfaces failures. vscode/src/right_to_forget.ts is the cascade's single home; task-31 and task-36 now carry acceptance criteria binding their future vector/cluster stores to it. 21 cascade tests (rollback, ordering, recovery, redirects, orphans, file sweep, origin edges) + 275 total + e2e green.
<!-- SECTION:FINAL_SUMMARY:END -->
