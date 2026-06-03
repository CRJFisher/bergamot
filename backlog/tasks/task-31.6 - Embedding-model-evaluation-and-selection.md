---
id: TASK-31.6
title: Embedding model evaluation and selection
status: To Do
assignee: []
created_date: "2026-06-02 12:22"
labels: []
dependencies:
  - TASK-31.1
  - TASK-31.3
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Select the embedding model by measured retrieval quality on Bergamot's own golden dataset, not by headline MTEB averages — no single model dominates all MTEB categories and a top-overall model can rank lower on Retrieval. Benchmark candidate models (incumbent text-embedding-3-small as the bar to beat, plus current Retrieval-strong API and open options) on Recall/nDCG and cost using the harness. Consider matryoshka dimension-trimming to cut LanceDB storage. Make the model swappable via config and re-embed under the winner. See backlog/docs/rag-pipeline-upgrade-plan.md (Phase G).


**Learning companion:** [backlog/docs/rag-explainers/06-embedding-selection.html](06-embedding-selection.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 At least three embedding models are benchmarked on the golden dataset by Retrieval metrics and cost
- [ ] #2 The model is selected by measured retrieval quality (not overall MTEB average) and the rationale is recorded
- [ ] #3 The embedding model is swappable via config
- [ ] #4 Matryoshka/dimension trade-offs are evaluated for storage cost
- [ ] #5 The corpus is re-embedded under the selected model
<!-- AC:END -->
