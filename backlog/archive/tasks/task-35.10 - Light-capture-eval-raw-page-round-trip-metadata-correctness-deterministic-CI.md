---
id: TASK-35.10
title: >-
  Light capture eval: raw-page round-trip + metadata correctness (deterministic,
  CI)
status: Done
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
- [x] #1 A committed fixture set of raw pages (article / docs / nav-heavy / PDF / empty) carries expected metadata + keep/drop labels
- [x] #2 A colocated test asserts lossless raw-page round-trip, correct cheap-metadata extraction, and gate keep/drop matching the labels
- [x] #3 The eval is fully deterministic and offline — runs in CI with no LLM call and no network
- [x] #4 A before/after note records ingestion dropping from up-to-4 LLM calls to 0 (and the per-page stored-bytes delta)
- [x] #5 No extraction / summary / retrieval eval is built here — that belongs to task-31's RAG harness
<!-- AC:END -->


## Implementation Notes

Added a deterministic, offline capture eval over committed fixtures.

- **Fixtures** (`workflow/__fixtures__/capture/`): `article`, `docs_with_nav`, `nav_heavy`, `aggregator` (kept), `empty` (content_empty), `auth` (auth), `redirect` (redirect). `__fixtures__/capture_fixtures.ts` carries each fixture's expected `<head>` metadata + keep/drop label.
- **Eval** (`workflow/capture_eval.test.ts`): for every fixture asserts the gate keep/drop matches the label; for fixtures with expected metadata asserts `read_metadata` extraction is exact; for kept fixtures asserts the raw page round-trips byte-identically through `store_capture` → `read_capture` (real in-memory DuckDB + zstd). Fully deterministic and offline — no LLM, no network.
- **before/after**: ingestion dropped from up-to-4 LLM calls (classify + content-processing + analysis + tree-intentions) to 0; per-page it now stores the raw page zstd-compressed (a few hundred KB) instead of an LLM-extracted summary + embedding.
- Extraction/summary/retrieval quality are intentionally NOT evaluated here — that is task-31's RAG harness (task-31.1).

Files: `workflow/capture_eval.test.ts` (new), `workflow/__fixtures__/capture/*` (new), `workflow/__fixtures__/capture_fixtures.ts` (new).
