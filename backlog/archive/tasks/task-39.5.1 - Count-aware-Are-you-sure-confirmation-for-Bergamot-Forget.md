---
id: TASK-39.5.1
title: 'Count-aware ''Are you sure'' confirmation for Bergamot: Forget'
status: To Do
assignee: []
created_date: '2026-06-10 09:44'
labels:
  - privacy
  - ux
  - storage
dependencies: []
references:
  - vscode/src/commands/command_manager.ts
  - vscode/src/right_to_forget.ts
parent_task_id: TASK-39.5
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`Bergamot: Forget` already confirms via a modal (`run_forget` in `command_manager.ts`: "Forget <what>? This permanently deletes the matching visits and all derived content. There is no undo."), but the user confirms BLIND: the blast radius is resolved only inside `forget()`, after the modal. A typo'd origin or an over-wide time range deletes far more than intended, and the user learns the count only from the post-hoc toast — when the data is already gone, by design unrecoverable.

APPROACH: make the confirmation count-aware. Export the resolver (`resolve_targets` in `right_to_forget.ts`) or add a read-only `preview_forget(metadata_db, selector)` that returns the would-be ForgetReport shape (visit count, distinct-URL count, buffered-file count) without deleting anything. `run_forget` resolves first, then shows the modal with the real numbers — "Permanently delete 412 visits across 38 URLs on https://example.com (plus 3 buffered files)? There is no undo." — and a zero-match selector short-circuits to the existing "nothing matched" message without a scary modal. The preview is advisory, not a lock: a visit ingested between preview and delete is still handled by the cascade's own resolution (it resolves again inside `forget()`), so the shown count can differ by the concurrency window — acceptable and worth one sentence in the modal helper's doc.

Cheapest change: reuse the existing resolution pass read-only; no schema, no new stores, no second resolver implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The confirmation modal states the resolved blast radius before anything is deleted: matching visit count, distinct-URL count, and buffered-file count for the chosen selector
- [ ] #2 A selector matching nothing short-circuits to the existing 'nothing matched' message without showing a deletion modal
- [ ] #3 Declining the modal deletes nothing across every store (metadata, cache, buffers, queue purge included)
- [ ] #4 The preview is read-only — verified by a test that previews then asserts all stores unchanged
<!-- AC:END -->
