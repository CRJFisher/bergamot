---
id: TASK-35.8
title: >-
  Replace the LLM classifier gate with a deterministic relevance gate
  (parity-checked)
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-04 18:02'
labels: []
dependencies:
  - TASK-35.7
references:
  - vscode/src/workflow/webpage_filter.ts
  - vscode/src/workflow/filter_metrics.ts
  - vscode/src/commands/command_manager.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run a small side-by-side comparison of the deterministic relevance gate (word_count / link-density / empty-content from the extractor) against the existing classify_webpage LLM gate on a sample of real captures; tune thresholds to acceptable parity. THEN delete classify_webpage, PAGE_FILTER_PROMPT, the 6-way taxonomy, should_process_page, DEFAULT_FILTER_CONFIG.allowed_types, and the per-page LLM classification call. Replace with evaluate_page_gate(essence) -> {keep, reason}. Update dev_log / command_manager / filter_metrics from page_type/confidence metrics to extraction-outcome metrics (extracted / dropped-no-article / word_count). PDFs / non-HTML get a dedicated drop branch (folds task-34 AC#3). This lands LAST among behavior changes — it is the change most likely to silently shift what gets stored. User decision: full usage-agnostic density gate only, no topic classification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A one-off DEV parity exercise (NOT a CI test) runs evaluate_page_gate vs classify_webpage over a saved sample of real captures (exported from the dev DuckDB); disagreements inspected, thresholds tuned, and both recorded in the task Implementation Notes before deletion
- [ ] #2 classify_webpage, PAGE_FILTER_PROMPT, the taxonomy, should_process_page, and DEFAULT_FILTER_CONFIG.allowed_types are deleted; the bergamot.webpageFilter.* settings (enabled/allowedTypes/minConfidence/logDecisions) are removed from vscode/package.json contributes.configuration; no per-page classification LLM call remains
- [ ] #3 evaluate_page_gate decides keep/drop from extractor signals with a config-tunable threshold; dropped pages recorded with reason and make zero LLM calls; CI tests over committed fixtures cover keep (article) and drop (empty/nav/aggregator/PDF) cases
- [ ] #4 The dev_log RecordOutcome shape and command_manager / filter_metrics are updated from page_type/confidence to extraction-outcome fields (extracted / drop_reason / word_count); no page_type / allowed_types references remain
- [ ] #5 PDFs / non-HTML are dropped with a specific reason rather than failing (folds task-34 AC#3)
<!-- AC:END -->
