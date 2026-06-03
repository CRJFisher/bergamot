---
id: TASK-31.5
title: "Clean ingestion: heuristic main-content extraction"
status: To Do
assignee: []
created_date: "2026-06-02 12:22"
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
