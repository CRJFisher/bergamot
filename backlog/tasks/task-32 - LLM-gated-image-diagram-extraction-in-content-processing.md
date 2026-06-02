---
id: TASK-32
title: LLM-gated image/diagram extraction in content processing
status: To Do
assignee: []
created_date: "2026-06-02 16:51"
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

During webpage content extraction, let the LLM decide whether to persist images that carry essential information (architecture diagrams, charts, figures) rather than discarding all images. Today the content-processing prompt only preserves inline image markdown; there is no path to save or reference the underlying image bytes/URL for later retrieval. This makes the captured knowledge incomplete for visually-dense pages and weakens downstream RAG.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Content-processing prompt instructs the LLM to flag content-critical images (diagrams/charts/figures) vs decorative ones,Flagged images are persisted (image URL/path recorded on the DuckDB webpage analysis row) and retrievable alongside page content,Decorative/boilerplate images are dropped,Image references are available to RAG ingestion (task-31.5 clean ingestion),Unit tests cover the flag/keep/drop decision and the persistence of flagged image references
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->

1. Extend CONTENT_PROCESSING_PROMPT (vscode/src/workflow/prompts.ts) to classify images as essential vs decorative\n2. Capture image URLs from raw HTML during processing in simple_workflow.ts\n3. Record kept-image references on the DuckDB analysis row (extend schema in duck_db / duck_db_models)\n4. Surface image references through the query/RAG path\n5. Coordinate scope with task-31.5 (main-content extraction)\n6. Add tests
<!-- SECTION:PLAN:END -->
