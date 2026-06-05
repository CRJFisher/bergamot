---
id: TASK-35.10
title: >-
  Light capture eval: raw-page round-trip + metadata correctness (deterministic,
  CI)
status: To Do
assignee: []
created_date: '2026-06-04 17:33'
updated_date: '2026-06-05 08:58'
labels: []
dependencies:
  - TASK-35.1
  - TASK-35.8
references:
  - vscode/src/workflow/embeddings.test.ts
parent_task_id: TASK-35
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A small committed fixture set of raw pages (article / docs-with-nav / nav-heavy / PDF / empty) with expected metadata and keep/drop labels. A colocated *.test.ts asserts: the raw page round-trips losslessly (compress -> store -> decompress is byte-identical), the cheap <head> metadata (title/site/author/date/lang) is extracted correctly, and the deterministic gate's keep/drop matches the labels. Fully deterministic and offline — runs in CI with no LLM and no network. Records a before/after note that ingestion drops from up-to-4 LLM calls to 0. Extraction / summary / retrieval quality are NOT evaluated here — those belong to task-31's RAG harness (task-31.1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A committed fixture set of raw pages (article / docs / nav-heavy / PDF / empty) carries expected metadata + keep/drop labels
- [ ] #2 A colocated test asserts lossless raw-page round-trip, correct cheap-metadata extraction, and gate keep/drop matching the labels
- [ ] #3 The eval is fully deterministic and offline — runs in CI with no LLM call and no network
- [ ] #4 A before/after note records ingestion dropping from up-to-4 LLM calls to 0 (and the per-page stored-bytes delta)
- [ ] #5 No extraction / summary / retrieval eval is built here — that belongs to task-31's RAG harness
<!-- AC:END -->
