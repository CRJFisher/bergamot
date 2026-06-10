---
id: TASK-39.8
title: Close the plaintext visit-inbox gap (encrypted durable visit buffer)
status: To Do
assignee: []
created_date: '2026-06-10 09:56'
labels:
  - security
  - privacy
  - storage
dependencies: []
references:
  - vscode/src/visit_inbox.ts
  - vscode/src/visit_queue_processor.ts
  - vscode/src/right_to_forget.ts
  - docs/threat-model.md
parent_task_id: TASK-39
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The durable visit inbox (`<storage_base>/visit_inbox/<id>.json`) persists every accepted visit as PLAINTEXT JSON — URL, referrer, title, timestamps — between HTTP accept and the DuckDB write, and a failed ingest leaves the file indefinitely. docs/threat-model.md names this as the largest remaining plaintext side-channel against adversary A (offline/file-level access): the metadata store is encrypted at rest, but its front door is not.

APPROACH (decide at implementation, destructively — no migration shim): either (a) move the durable buffer INTO the encrypted metadata store as a queue table (`visit_inbox` rows written before the 200 response, deleted after the capture pipeline commits; restart recovery reads the table instead of the directory — same process already owns the single writer connection), or (b) encrypt the per-visit files with a SecretStorage-backed key. Option (a) is likely cheaper and removes a whole artifact class: one store, one key, one forget path. Whichever lands: update the right-to-forget cascade's file sweep (right_to_forget.ts sweeps visit_inbox/*.json today), the queue processor's reload path, backlog/docs/dev-db-reset.md's store list, and the threat model's side-channel paragraph (the gap is closed, not re-worded). The dev replay ring (captures/) is dev-only and gated; it is NOT in scope here — see the dev-log task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No plaintext visit data (URL, referrer, title, timestamps) is written to disk at any point between HTTP accept and the DuckDB write, verified by a byte-scan test during a real ingest
- [ ] #2 Restart recovery still works: visits accepted but not yet stored survive an extension restart and are ingested exactly once
- [ ] #3 The right-to-forget cascade covers the new buffer (a forgotten visit sitting in the buffer is deleted, not resurrected)
- [ ] #4 docs/threat-model.md no longer lists the visit inbox as an open plaintext side-channel; dev-db-reset.md reflects the new layout
<!-- AC:END -->
