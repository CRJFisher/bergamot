---
id: TASK-35
title: Simplify webpage processing into a zero-LLM raw-capture pipeline
status: Done
assignee: []
created_date: '2026-06-04 17:31'
updated_date: '2026-06-05 10:25'
labels:
  - pipeline
  - refactor
  - llm
  - cost
dependencies: []
references:
  - docs/architecture/page-processing.html
  - vscode/src/workflow/simple_workflow.ts
  - vscode/src/workflow/webpage_filter.ts
  - vscode/src/workflow/html_reduce.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the up-to-4-LLM-call categoriser with a capture-first, ZERO-LLM ingestion pipeline. Ingestion becomes pure, lossless, deterministic capture: a cheap deterministic relevance gate decides keep/drop, lightweight metadata (title, site, author, published date, lang) is read non-LLM from the HTML <head>/og: tags (no main-content extraction), and the raw page is stored zstd-compressed in DuckDB webpage_capture, keyed by page_session_id. NO model is called at ingest. All interpretation — main-content extraction, chunking, embedding, summarisation — moves to the RAG-prep pipeline (task-31), which reads stored raw pages and can re-run over the whole corpus with better algorithms (impossible if extraction were lossily baked into capture). Usage-specific intentions and the tree_intentions loop are removed; navigation-tree structure is independent and keeps working.

Rationale: a page can never be re-captured, so lossy extraction at ingest is an irreversible loss; storing the raw page (a few hundred KB zstd) is cheap and makes the corpus re-indexable. This supersedes the earlier 'extract the essence at ingest' design.

Honors the no-backwards-compat constitution (destructive dev-DB reset, no shims) and no-stateful-classes (WebpageWorkflow dissolves into functions). Companion: docs/architecture/page-processing.html.

Decision (LOCKED): NO interim embedding — ingestion writes nothing to LanceDB; semantic search is deferred to the RAG-prep pipeline (task-31) and returns empty until that index is built. Implementation notes: zstd is @mongodb-js/zstd (already a dependency, exposes compress/decompress); the server already decodes the incoming base64 zstd into a Buffer before decompressing for the size-guard, so the raw page can be stored from that original buffer without re-compressing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ingestion makes ZERO LLM calls; capture is fully deterministic and offline (no auth / prompt-length / non-JSON failure surface) — asserted via an injected jest.fn() LLM mock showing 0 calls for any captured page
- [x] #2 The raw page is stored losslessly (zstd-compressed BLOB) in DuckDB webpage_capture keyed by page_session_id, as the durable source of truth for downstream extraction/RAG; compress->store->decompress is byte-identical
- [x] #3 Cheap metadata (title, site_name, author, published_at, lang) is read non-LLM from the HTML <head>/og: tags — no main-content extraction at ingest
- [x] #4 The LLM classifier, content-processing, analysis (title/summary/intentions) and tree-intentions calls are all deleted; intentions and tree_intentions are removed from schema and types; navigation trees still build (url, title) with those fields absent
- [x] #5 A deterministic relevance gate replaces the knowledge-only classifier. SCOPE REVISED (user, 2026-06-05): the gate is permissive — it keeps essentially everything and drops only transient interstitials (empty / auth / redirect); content-size/link-density/PDF heuristics were dropped as YAGNI/fallible. PDFs/non-HTML are simply kept and captured as raw bytes (never fail).
- [x] #6 All extraction / chunking / embedding / summarisation moves to the RAG-prep pipeline (task-31); the raw page is the parent-document source so task-31.3 is not blocked. LanceDB is fully decoupled from the capture/query flow (task-35.12, added per user request); semantic search is deferred to task-31.
- [x] #7 MOVED to task-31.10: a configurable per-role model default (bergamot.models.fast = Haiku) has no consumer in the now zero-LLM flow (YAGNI), so it lands with task-31 where LLM calls are reintroduced.
- [x] #8 All schema changes are destructive dev-DB resets (no ALTER/backfill, no shims); a documented reset procedure exists and every schema-changing subtask references it
- [x] #9 simple_workflow.ts / WebpageWorkflow and related vestigial names are renamed; no stateful workflow class remains; all callers updated with no aliases
- [x] #10 A light capture eval asserts raw-page round-trip (lossless) and metadata correctness; there is no LLM eval at ingest
<!-- AC:END -->
