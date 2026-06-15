---
id: TASK-39.8
title: Close the plaintext visit-inbox gap (encrypted durable visit buffer)
status: Done
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
- [x] #1 No plaintext visit data (URL, referrer, title, timestamps) is written to disk at any point between HTTP accept and the DuckDB write, verified by a byte-scan test during a real ingest
- [x] #2 Restart recovery still works: visits accepted but not yet stored survive an extension restart and are ingested exactly once
- [x] #3 The right-to-forget cascade covers the new buffer (a forgotten visit sitting in the buffer is deleted, not resurrected)
- [x] #4 docs/threat-model.md no longer lists the visit inbox as an open plaintext side-channel; dev-db-reset.md reflects the new layout
<!-- AC:END -->

## Implementation Notes

### High-level summary

The visit inbox is now a table inside the encrypted DuckDB metadata store rather than a directory of plaintext JSON files. Visits-in-flight are never written to disk as readable data: the server calls `persist_visit(db, visit)` — an INSERT into `visit_inbox` — before returning 200 to the browser, and the queue processor calls `remove_visit(db, id)` once the visit is committed to the metadata store. On restart, `load_inbox(db)` reads the table and requeues any survivors; each row is deleted exactly once.

**Option A was chosen** (move the buffer into the encrypted store). It removes the `visit_inbox/` directory entirely — one store, one encryption key, one right-to-forget path — and sidesteps the per-file encryption complexity of Option B.

**Key changes:**

- `visit_types.ts` — new module extracted to hold `ExtendedPageVisit` and `is_complete_visit`, breaking the circular import that would otherwise form between `visit_inbox.ts` and `visit_queue_processor.ts`. All consumers (`visit_inbox.ts`, `visit_queue_processor.ts`, `visit_replay.ts`, `server_manager.ts`) import from here.
- `duck_db.ts` — `VISIT_INBOX_TABLE = "visit_inbox"` constant; `create_metadata_schema` creates the table with `id TEXT PRIMARY KEY`, `url`, `page_loaded_at`, and `visit_json` (full JSON blob, brotli not needed for small rows). `ON CONFLICT (id) DO NOTHING` ensures idempotent inserts.
- `visit_inbox.ts` — completely rewritten: `persist_visit`, `remove_visit`, `load_inbox`. `load_inbox` validates each row with `is_complete_visit` and deletes malformed entries so a schema mismatch from a future migration cannot wedge the queue.
- `visit_queue_processor.ts` — `start()` is now async; it calls `load_inbox(db)` to reload persisted visits before scheduling the batch timer. `process_single_visit` returns `true` for all non-orphan paths (not just `was_tree_changed=true`) so inbox rows are removed even for visits already durably present in the metadata store — preventing accumulation across restarts.
- `right_to_forget.ts` — `sweep_visit_inbox(metadata_db, selector)` sweeps the inbox table before the metadata transaction. `sweep_visit_files` is replaced by `sweep_replay_captures`, which covers only `captures/` (dev replay ring, explicitly out of scope). The cascade ordering (inbox sweep before transaction) prevents a forgotten visit in the buffer from being resurrected by a concurrent accept.
- `server_manager.ts` — `/visit` route wraps `persist_visit` in try/catch; a DuckDB failure returns 500 JSON rather than a hung connection. `inbox_dir` removed from `ServerConfig`.
- `command_manager.ts` — `count_inbox()` queries the `visit_inbox` table via `load_inbox()`; the dead filesystem path is removed.
- `docs/threat-model.md` — Asset #3 (visit inbox as plaintext side-channel) removed; renumbered; "Plaintext side-channels" paragraph updated.
- `docs/architecture/` — both `index.html` and `vscode-extension.html` updated to describe the encrypted DB table instead of the JSON file directory.
- `backlog/docs/dev-db-reset.md` — `visit_inbox/` directory removed from store list; metadata file description notes the `visit_inbox` table.

**Test coverage:** `visit_inbox.test.ts` covers: persist/reload, remove, malformed-entry eviction, empty inbox + double-remove, AC#1 filename scan, AC#1 raw byte-scan (reads file bytes from encrypted file-backed DB and asserts the sentinel URL is not present as plaintext), AC#2 restart recovery (file-backed DB, close+reopen+verify, then exactly-once removal across a third open). `right_to_forget.test.ts` covers the AC#3 cascade: sweeps matching `visit_inbox` rows and leaves `captures/` untouched.
