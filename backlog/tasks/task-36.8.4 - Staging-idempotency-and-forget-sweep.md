---
id: TASK-36.8.4
title: Staging idempotency + right-to-forget filesystem sweep
status: Done
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.8.3
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make staging trustworthy and forgettable. Idempotency: a deterministic filename per
lineage (ISO-week + slug of the label; `lifeline_id` once Phase-4 lands) so a re-run
overwrites its own un-promoted draft rather than spawning a duplicate. Promotion-safety:
a `.bergamot-ledger.json` records every lineage emitted; a known lineage whose file is gone
was promoted/discarded by the user and is never recreated or resurrected, and a file absent
from the ledger is never clobbered. A changed-fingerprint gate skips rewriting unchanged
content. Right-to-forget: staged stubs are plaintext outside the encrypted stores, so the
cascade gains a filesystem sweep that deletes any stub citing a forgotten URL/origin (via
the citation key) or whose frontmatter window overlaps a forgotten time-range.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 Deterministic per-lineage filename; re-run overwrites the same un-promoted draft
- [x] #2 Promotion-safe: a promoted/discarded stub is never recreated; a user-owned file is never clobbered
- [x] #3 Changed-fingerprint gate skips identical re-writes
- [x] #4 `right_to_forget.ts` sweeps staged stubs by citation key / window overlap; `ForgetReport.staged_stubs_removed`; ordered + idempotent like the existing cascade

<!-- AC:END -->

## Implementation Notes

### High-level summary

The ledger + fingerprint gate live in `staging_writer.ts` (`stage_note_stub` returns
`written` / `skipped_unchanged` / `skipped_promoted`). `sweep_staged_stubs` is called from
`right_to_forget.ts` before the metadata transaction (derived-first, like the visit-buffer
sweep); a forgotten stub's ledger entry is removed so a later run may re-stage surviving
threads, distinct from a user-promoted stub whose entry stays. `ForgetReport` gains
`staged_stubs_removed`; `command_manager.ts` passes the resolved `staging_root` into
`forget()` and reports the count. Covered by `staging_writer.test.ts` and additions to
`right_to_forget.test.ts`.
