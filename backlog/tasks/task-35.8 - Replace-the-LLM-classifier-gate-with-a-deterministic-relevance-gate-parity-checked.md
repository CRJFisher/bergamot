---
id: TASK-35.8
title: >-
  Replace the LLM classifier gate with a deterministic relevance gate
  (parity-checked)
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-05 08:58'
labels: []
dependencies:
  - TASK-35.1
references:
  - vscode/src/workflow/webpage_filter.ts
  - vscode/src/workflow/filter_metrics.ts
  - vscode/src/commands/command_manager.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the LLM classifier with a deterministic relevance gate operating on cheap capture signals (raw content size / link-density / content-type / empty-or-error page) — NOT on any extracted article (no extraction happens at ingest). First run a one-off DEV parity exercise comparing the gate against the existing classify_webpage over a saved sample of real captures and tune thresholds. THEN delete classify_webpage, PAGE_FILTER_PROMPT, the 6-way taxonomy, should_process_page, DEFAULT_FILTER_CONFIG.allowed_types, and the bergamot.webpageFilter.* settings in vscode/package.json. Replace with evaluate_page_gate(raw_page, metadata) -> {keep, reason}. Update dev_log RecordOutcome + command_manager + filter_metrics from page_type/confidence to capture-outcome fields. PDFs/non-HTML get a dedicated drop branch (folds task-34 AC#3). User decision: full usage-agnostic gate, no topic classification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A one-off DEV parity exercise (NOT a CI test) compares the deterministic gate vs classify_webpage over a saved sample of real captures (exported from the dev DB); disagreements and chosen thresholds are recorded in the Implementation Notes before deletion
- [ ] #2 classify_webpage, PAGE_FILTER_PROMPT, the taxonomy, should_process_page and DEFAULT_FILTER_CONFIG.allowed_types are deleted; the bergamot.webpageFilter.* settings (enabled/allowedTypes/minConfidence/logDecisions) are removed from vscode/package.json; no classification LLM call remains
- [ ] #3 evaluate_page_gate(raw_page, metadata) -> {keep, reason} decides from content size / link-density / content-type with a config-tunable threshold; dropped pages recorded with reason; CI tests over committed fixtures cover keep (article) and drop (empty/nav/aggregator/PDF)
- [ ] #4 dev_log RecordOutcome + command_manager + filter_metrics are updated from page_type/confidence to capture-outcome fields (captured / drop_reason / byte_size); no page_type / allowed_types references remain
- [ ] #5 PDFs / non-HTML are dropped with a specific reason rather than failing (folds task-34 AC#3)
<!-- AC:END -->
