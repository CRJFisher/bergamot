---
id: TASK-31.1
title: RAG evaluation harness (measurement spine)
status: To Do
assignee: []
created_date: "2026-06-02 12:21"
labels: []
dependencies: []
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Build the measurement foundation for the whole RAG overhaul: nothing else merges without a measured delta against a baseline. Construct a golden dataset of queries mapped to known-relevant pages drawn from the user's own corpus — the re-downloadable public subset (pages re-downloaded during post-processing, task-39.2); auth-walled / failed-re-download visits are metadata-only and out of scope for retrieval — plus a metrics suite covering retrieval (Recall@k, MRR, nDCG) and generation (context precision/recall, faithfulness, answer relevance) scored RAGAS-style with an LLM-as-judge. Capture a baseline report for the current whole-page pure-dense pipeline so every later phase reports an improvement delta. This is the portfolio centrepiece — it is what makes the pipeline 'production-grade' rather than asserted. Evaluation limitation: a re-downloaded page is not guaranteed to equal the page as viewed (JS-rendered/dynamic content, paywall/consent drift, A/B variants, edits over time), so golden-corpus content and relevance labels carry this re-download fidelity caveat. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase A). Supersedes task-30 ACs #1/#3/#4/#7.


**Learning companion:** [backlog/docs/rag-explainers/01-evaluation-harness.html](01-evaluation-harness.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A golden dataset of query to relevant-page(s) is built from Bergamot's own captured corpus and stored in-repo
- [ ] #2 Retrieval metrics (Recall@k MRR nDCG) are computed by a runnable harness script
- [ ] #3 Generation metrics (context precision/recall faithfulness answer-relevance) are computed via an LLM-as-judge
- [ ] #4 A baseline report for the current whole-page pure-dense pipeline is recorded and committed
- [ ] #5 The harness emits a single comparable report so any pipeline change yields a measurable delta
<!-- AC:END -->
