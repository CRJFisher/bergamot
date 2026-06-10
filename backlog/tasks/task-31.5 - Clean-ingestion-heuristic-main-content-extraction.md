---
id: TASK-31.5
title: 'Clean ingestion: heuristic main-content extraction'
status: Done
assignee: []
created_date: '2026-06-02 12:22'
updated_date: '2026-06-10 16:31'
labels: []
dependencies:
  - TASK-31.1
  - TASK-39.2
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce noise entering the vectors by pruning non-content HTML (nav, footer, aside, ad containers, social widgets) via heuristic main-content extraction (tree-pruning + link-density analysis, Trafilatura-style) before the existing LLM content step, so both the LLM and the embeddings see clean article text. Extraction runs over RE-DOWNLOADED public HTML supplied by the post-processing fetcher (task-39.2), not stored captured HTML — capture records metadata only and stores no page body. Can land in parallel with task-31.3. Do NOT cite specific extraction F1 leaderboard numbers — that specific research claim was refuted. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase B).

**Learning companion:** [backlog/docs/rag-explainers/05-clean-ingestion.html](05-clean-ingestion.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Re-downloaded public HTML (from the task-39.2 fetcher) passes through heuristic main-content extraction that prunes nav/footer/aside/ad/social elements before LLM processing
- [x] #2 Extracted markdown is measurably cleaner (less boilerplate) than the current output on sample noisy pages
- [ ] #3 The change shows neutral-or-better retrieval quality on the harness
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RE-SCOPED by task-35 (essence-capture pipeline). The core of this task — heuristic non-LLM main-content extraction — is promoted to first-class work in task-35.1 (Defuddle + linkedom). This task is superseded; its only genuinely RAG-specific AC ('neutral-or-better retrieval on the harness') should be carried as a DEFERRED post-harness verification under task-31.1, not a blocker for landing the extractor. Remove the inverted dependency on task-31.1. Recommend archiving once task-35.1 lands.

UPDATE (privacy-core reorientation, task-39): capture stores browsing metadata only — no page body is persisted, so there is no stored raw HTML to extract from. Non-LLM main-content extraction (Defuddle + linkedom) STAYS here as a RAG-prep step that reads RE-DOWNLOADED public HTML supplied by the post-processing fetcher (task-39.2) and feeds chunking (task-31.3). Auth-walled / failed-re-download visits have no content and are excluded. This task remains the extraction step of the RAG pipeline; its dependency on task-31.1 (eval harness) is appropriate.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Re-downloaded public HTML now passes through a single heuristic main-content extraction pass at the corpus boundary before any consumer reads it. One `parse_page` call (Defuddle + linkedom, via `redownload/main_content.ts`) yields both clean main-content markdown — nav/footer/aside/ad/social boilerplate pruned — and the page's derived metadata (title, author, published, site, lang), so `CorpusContent.content` is the extracted markdown and the `webpage_fetch` log records the same parse. This replaces the regex `read_metadata` reader, which is deleted; the fetcher slims to fetch+classify+hash (`FetchResult.metadata` removed).

Defuddle runs locally and deterministically (`useAsync: false` — no third-party API fetches, the privacy gate) and emits markdown (`markdown: true`). It is loaded by absolute-path require (`require.resolve("defuddle")` + the sibling `node.js`) to sidestep its ESM-only `./node` export condition under CommonJS — a dynamic `import()` would transpile to the same rejected require. `defuddle`/`linkedom`/`turndown` ship as VSIX externals (bundle_manifest.mjs). On empty extraction or a parser failure, `parse_page` degrades to the raw HTML rather than dropping the page (logged without the URL).

AC#1 (extraction prunes nav/footer/aside/ad/social before any LLM step) and AC#2 (extracted markdown measurably cleaner than the raw page on noisy fixtures) are met and covered by `main_content_eval.test.ts` over the committed `__fixtures__/main_content_pages/` set, plus `main_content.test.ts` for the degrade/normalization edges. AC#3 (neutral-or-better retrieval on the harness) is DEFERRED to task-31.1: the RAG evaluation harness does not exist yet, so this is carried as a post-harness verification there, not a blocker for landing the extractor.

Companion: `task-31.5 - …implementation.html` (committed). Default-path caching of the extracted markdown is the sibling task-39.10.
<!-- SECTION:FINAL_SUMMARY:END -->
