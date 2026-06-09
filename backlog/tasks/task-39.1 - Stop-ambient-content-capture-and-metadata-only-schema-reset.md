---
id: TASK-39.1
title: "Stop ambient content capture + metadata-only DuckDB schema reset"
status: Done
assignee: []
created_date: "2026-06-08 13:30"
labels:
  - capture
  - schema
  - privacy
dependencies:
  - TASK-39.2
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - backlog/drafts/privacy-reorientation-plan.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Remove all ambient page-content capture and storage so the capture path writes metadata only. Destructive change, no backwards-compat shims (constitution rule).

BROWSER (stop reading/sending content): delete content extraction and compression — `extract_page_content`, `MAX_CONTENT_BYTES`, `compress_content` in `browser/src/core/data_collector.ts`; the whole `browser/src/core/visit_compression.ts` module and its wiring in `browser/src/background.ts`; the `@hpcc-js/wasm-zstd` dep. Remove `content` from `VisitData` (`browser/src/types/navigation.ts`) and all call sites. The visit payload becomes metadata only (url, title, page_loaded_at, session graph) — title/url/timestamp read directly from the tab.

SERVER (stop decompress + store): remove the decompress block and `MAX_DECOMPRESSED_BYTES` in `vscode/src/server/server_manager.ts`; stop populating any raw-content field; drop the `@mongodb-js/zstd` dep; reduce the inflated body limit.

SCHEMA (destructive reset, no migration): drop `content_compressed`, `content_encoding`, `original_byte_size` from `webpage_capture` in `vscode/src/duck_db.ts`; remove the BLOB write and `get_webpage_capture_bytes`. Update `store_capture.ts`, `page_capture_pipeline.ts`, `visit_queue_processor.ts`, `duck_db_models.ts`, `page_capture_models.ts`, `visit_replay.ts`, `orphaned_visits.ts` to carry no content. `read_metadata.ts`'s `<meta>` parsing moves to re-download (task-39.2); title still comes from the tab.

GATE: `page_gate.ts` keeps incognito refusal only; empty/auth/redirect dropping moves to re-download time (the gate no longer sees content).

TESTS/FIXTURES: rewrite or delete the capture/storage tests and obsolete HTML fixtures to the metadata-only contract — do NOT add shims to keep old tests green.

DEPENDS ON 39.2: the content read path must be repointed at re-download before stored content is dropped.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 The browser sends a metadata-only visit payload (no `content`, no compression); `visit_compression.ts` and the zstd dep are deleted
- [x] #2 The server ingests metadata only; the decompress/store path and `@mongodb-js/zstd` are removed
- [x] #3 The `webpage_capture` schema has no content/compression columns (`content_compressed`/`content_encoding`/`original_byte_size`), applied as a destructive reset with no migration shim
- [x] #4 Title, URL, and load timestamp are captured directly from the tab; `<meta>`-derived fields are not read at capture
- [x] #5 The capture gate keeps only incognito refusal; no content-based gating remains at capture
- [x] #6 Browsing produces zero stored page content, verified by a test
- [x] #7 The capture/storage test suite and obsolete fixtures are rewritten or deleted to the metadata-only contract (no shims kept to stay green); build and tests are green
<!-- AC:END -->

## Implementation Notes

## High-level summary

Bergamot's organizing principle is privacy: capture must record browsing metadata only and never page content, because content read from a logged-in browser would defeat the login-wall privacy filter (only the cookie-less re-downloader should ever read content). This task makes the capture path honor that — it stops reading, sending, and storing page content end to end, and resets the store to metadata only.

The shape of the change is "remove, not neuter." The browser content script reads only the URL and the tab's `document.title`; there is no content extraction and no zstd compression anywhere (the `visit_compression` module and both zstd dependencies are deleted, and the manifest drops `'wasm-unsafe-eval'`). Title becomes a first-class field that threads `VisitData.title` → `POST /visit` body → `ExtendedPageVisit.title` → the capture pipeline → the `webpage_capture` row, replacing the old path that derived title by parsing the page `<head>` server-side. The server no longer decompresses anything and its body limit drops to 1mb.

The DuckDB `webpage_capture` table is reset destructively (no migration) to `page_session_id / url / title / content_type / captured_at`. The three compression columns and the four `<meta>`-derived columns (`site_name`, `author`, `published_at`, `lang`) are dropped — those derived fields are now owned exclusively by the re-download fidelity log (`webpage_fetch`, task-39.2). The `content` field leaves the `PageActivitySession` model and the now-redundant variants collapse: `PageActivitySessionWithoutContent` is dropped (it equalled `PageActivitySession`) and `WithoutTreeOrContent` is renamed `WithoutTree`.

With no content at capture, the content-based capture gate has nothing to judge, so `page_gate`, `gate_metrics`, and the dead `show_gate_metrics` VS Code command are deleted; empty/auth/redirect exclusion already lives at re-download time (`redownload/fetch_outcome.ts`). "Incognito refusal" — previously unimplemented anywhere — is honored at the cheapest correct layer: the browser manifest's `"incognito": "not_allowed"`, which disables the extension in private windows entirely.

To navigate the result: capture flows `content.ts` → server `/visit` (`server_manager.ts`) → visit queue → `run_page_capture` (`page_capture_pipeline.ts`) → `store_capture` → `insert_webpage_capture` (`duck_db.ts`). `read_metadata.ts` survives but is now used only by the re-download corpus (`redownload/corpus.ts`), not the capture path. Page content and the derived metadata are obtained on demand by re-downloading the public URL.

What to watch: the schema change requires a **destructive dev-DB reset** (delete the DuckDB file + visit inbox per `backlog/docs/dev-db-reset.md`) — there is no migration, so an old DB keeps the former NOT-NULL content columns and would reject the new metadata-only inserts. AC#6 is guarded by an integration test that asserts `webpage_capture` has no content column after a real ingest. The downstream `<meta>` fields now come from `webpage_fetch`; consumers reading site/author/published/lang must source them there.

### Review notes

A 10-lens opus review found no behavioral or contract bugs (title threads cleanly; the re-download read path is intact; no consumer reads a dropped field). Applied fixes: stale comments corrected across the touched files; an incognito-refusal pointer comment added to `background.ts`; the constitution (principle 2 + the capture-gate bullet) and the `page-processing.html` / `storage.html` architecture docs updated to the no-gate, metadata-only schema; the dead `CaptureFixture.content_type` field removed. The reviewers' "no documented cutover" concern is already covered by `backlog/docs/dev-db-reset.md`. Noted but not actioned (out of scope): physically relocating `read_metadata.ts` to `redownload/`, collapsing the thin `store_capture`/pipeline seams, and the pre-existing stale `full_pipeline.spec.ts` "Fake Title" e2e assertion.
