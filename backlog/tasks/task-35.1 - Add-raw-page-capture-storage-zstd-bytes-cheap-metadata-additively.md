---
id: TASK-35.1
title: Add raw-page capture storage (zstd bytes + cheap metadata) additively
status: To Do
assignee: []
created_date: '2026-06-04 17:31'
updated_date: '2026-06-05 08:57'
labels: []
dependencies:
  - TASK-35.3
references:
  - vscode/src/workflow/html_reduce.ts
  - vscode/src/workflow/simple_workflow.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce a DuckDB table webpage_capture(page_session_id TEXT PRIMARY KEY, content_compressed BLOB, content_encoding TEXT, original_byte_size INT, content_type TEXT, url TEXT, title TEXT, site_name TEXT, author TEXT, published_at TEXT, lang TEXT, captured_at TEXT) and write the raw page to it zstd-compressed (reuse the zstd codec already on the capture path — the browser zstd-compresses for transport per commit 3a38b9d; do not add a heavyweight new dep). Read cheap metadata non-LLM from the HTML <head> / Open-Graph tags (linkedom or a light parse) — NO main-content extraction. Land ADDITIVELY alongside the existing LLM pipeline (which keeps writing webpage_analysis) so e2e stays green; later subtasks delete the LLM calls and the old table. References the task-35.3 dev-DB reset procedure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 webpage_capture table exists (page_session_id PK + content_compressed BLOB + content_encoding + original_byte_size + content_type + url + title + site_name + author + published_at + lang + captured_at); the raw page is persisted zstd-compressed keyed by page_session_id
- [ ] #2 compress -> store -> decompress round-trips byte-identically (a test asserts lossless recovery of the original page)
- [ ] #3 Cheap metadata (title, site_name, author, published_at, lang) is read non-LLM from the <head> / og: tags; no main-content extraction runs
- [ ] #4 Lands additively — the existing LLM pipeline still runs and e2e stays green
- [ ] #5 The zstd codec is reused from the capture path (no new heavyweight dependency) and verified to bundle in the CJS/esbuild output
<!-- AC:END -->
