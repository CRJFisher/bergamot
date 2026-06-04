---
id: TASK-35
title: Simplify webpage processing into a deterministic essence-capture pipeline
status: To Do
assignee: []
created_date: '2026-06-04 17:31'
updated_date: '2026-06-04 18:01'
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
Replace the current up-to-4-LLM-call categoriser pipeline with a deterministic essence-capture pipeline. Non-LLM main-content extraction (Defuddle + linkedom) becomes the core: it isolates the article and yields clean markdown plus title, excerpt, author, site, published date, word_count, lang and lead image for free — replacing the content-processing LLM call. A deterministic content-density relevance gate (word_count / link-density / empty-content) replaces the 6-way LLM "knowledge-only" classifier, so storage becomes usage-agnostic (any page with a real article body is stored). At most one cheap Haiku call produces {summary, topics} over the already-clean text, skipped for dropped pages. Usage-specific "intentions" and the entire tree_intentions loop (the only sonnet spend) are removed; navigation-tree structure is independent and keeps working. The stored shape becomes one canonical PageEssence record (DuckDB webpage_essence + LanceDB content) that is downstream-agnostic and does not block deferred RAG chunking (task-31.3). Haiku becomes the explicit, configurable default. Honors the no-backwards-compat constitution (destructive dev-DB reset, no migration shims) and the no-stateful-classes rule (WebpageWorkflow dissolves into functions).

User decisions locked: (1) full usage-agnostic density gate only — no topic classification at ingest; (2) keep exactly one Haiku call for {summary, topics} with the extractor excerpt as fallback; (3) Defuddle + linkedom as the extractor (Readability + turndown documented as the all-CJS fallback); (4) full IA remodel, with pure renames isolated into the final rename-only PR.

Net per-page cost: stored page = 1 Haiku call (down from up to 4, including the only sonnet call); dropped page = 0 LLM calls.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 For a stored page the pipeline makes exactly one LLM call (Haiku summary+topics); for a dropped page it makes zero LLM calls — verified end-to-end only after task-35.4/.5/.7/.8 land, asserted via an injected jest.fn() LLM mock (FakeLLMClient has no call counter)
- [ ] #2 Main-content extraction is non-LLM (Defuddle + linkedom, Readability + turndown as fallback) and produces clean markdown + title + excerpt + reading metadata
- [ ] #3 The LLM knowledge-only classifier (classify_webpage, PAGE_FILTER_PROMPT, 6-way taxonomy) is deleted and replaced by a deterministic relevance gate
- [ ] #4 intentions and tree_intentions are removed from capture, storage, schema and types; navigation trees still build and render (url, title, content, summary) with those fields absent
- [ ] #5 A single usage-agnostic PageEssence record is the canonical stored shape across DuckDB and LanceDB; no intentions column remains
- [ ] #6 Haiku is the explicit configurable default via bergamot.models.fast (the live role), byte-identical when unset; the 'smart' role key is retained in the model map but not user-exposed until a smart caller returns
- [ ] #7 All schema changes are destructive dev-DB resets (no ALTER/backfill, no compatibility shims); a documented wipe + first-run-recreate procedure exists and every schema-changing subtask references it
- [ ] #8 simple_workflow.ts / WebpageWorkflow and related vestigial names are renamed; no stateful workflow class remains; all callers (incl. server_manager.ts and the build_workflow factory) updated with no aliases
- [ ] #9 A light golden-set eval asserts non-LLM extraction coverage in CI; Haiku summary acceptability is a separately-gated (non-CI) eval; a before/after tokens-per-page figure is recorded
- [ ] #10 The full canonical markdown is stored durably in DuckDB webpage_essence.markdown (independent of LanceDB) keyed by page_session_id as the stable chunk↔page id, so deferred RAG chunking + parent-document retrieval (task-31.3) is not blocked
<!-- AC:END -->
