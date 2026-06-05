---
id: TASK-31.5
title: 'Clean ingestion: heuristic main-content extraction'
status: To Do
assignee: []
created_date: '2026-06-02 12:22'
updated_date: '2026-06-05 08:58'
labels: []
dependencies:
  - TASK-31.1
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce noise entering the vectors by pruning non-content HTML (nav, footer, aside, ad containers, social widgets) via heuristic main-content extraction (tree-pruning + link-density analysis, Trafilatura-style) before the existing LLM content step, so both the LLM and the embeddings see clean article text. Can land in parallel with task-31.3. Do NOT cite specific extraction F1 leaderboard numbers — that specific research claim was refuted. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase B).

**Learning companion:** [backlog/docs/rag-explainers/05-clean-ingestion.html](05-clean-ingestion.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Captured HTML passes through heuristic main-content extraction that prunes nav/footer/aside/ad/social elements before LLM processing
- [ ] #2 Extracted markdown is measurably cleaner (less boilerplate) than the current output on sample noisy pages
- [ ] #3 The change shows neutral-or-better retrieval quality on the harness
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RE-SCOPED by task-35 (essence-capture pipeline). The core of this task — heuristic non-LLM main-content extraction — is promoted to first-class work in task-35.1 (Defuddle + linkedom). This task is superseded; its only genuinely RAG-specific AC ('neutral-or-better retrieval on the harness') should be carried as a DEFERRED post-harness verification under task-31.1, not a blocker for landing the extractor. Remove the inverted dependency on task-31.1. Recommend archiving once task-35.1 lands.

UPDATE (capture-first redesign of task-35): extraction is NO LONGER pulled forward into ingestion. task-35 now stores the raw page losslessly and makes zero LLM calls at ingest; non-LLM main-content extraction (Defuddle + linkedom) STAYS here as a RAG-prep step that reads stored raw pages (webpage_capture.content_compressed) and feeds chunking (task-31.3). This task is no longer 'absorbed' by task-35 — it remains the extraction step of the RAG pipeline. Its dependency on task-31.1 (eval harness) is appropriate again.
<!-- SECTION:NOTES:END -->
