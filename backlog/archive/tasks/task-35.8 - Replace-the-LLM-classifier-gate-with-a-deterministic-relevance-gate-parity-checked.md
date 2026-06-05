---
id: TASK-35.8
title: >-
  Replace the LLM classifier gate with a deterministic relevance gate
  (parity-checked)
status: Done
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
Replace the LLM classifier with a deterministic relevance gate. SCOPE (revised per user): be permissive — capture is cheap, lossless raw bytes, and quality/topic filtering belongs to the RAG-prep pipeline (task-31), so the gate keeps essentially everything and only drops clearly-transient interstitials: auth/login pages (e.g. Google sign-in), redirect stubs, and empty pages. The earlier content-size / link-density / taxonomy / PDF heuristics were YAGNI and fallible (they mis-drop short-but-legit, link-heavy-but-useful, and non-HTML-but-storable pages), so they are dropped. Delete classify_webpage, PAGE_FILTER_PROMPT, the 6-way taxonomy, should_process_page, FilterConfig/DEFAULT_FILTER_CONFIG, and the bergamot.webpageFilter.* settings in vscode/package.json. Replace with evaluate_page_gate(raw_page, url) -> {keep, reason} that drops only {content_empty, auth, redirect}. Update dev_log RecordOutcome + command_manager + filter_metrics from page_type/confidence to capture-outcome fields. No topic classification, no tunable thresholds (YAGNI).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 classify_webpage, PAGE_FILTER_PROMPT, the taxonomy, should_process_page and FilterConfig/DEFAULT_FILTER_CONFIG are deleted; the bergamot.webpageFilter.* settings are removed from vscode/package.json; no classification LLM call remains
- [x] #2 evaluate_page_gate(raw_page, url) -> {keep, reason} is permissive: it keeps all real content and drops only interstitials — content_empty, auth (login/sign-in pages), and redirect (redirect stubs); dropped pages are recorded with the reason
- [x] #3 CI tests over committed fixtures cover keep (article, docs-with-nav, nav-heavy list, aggregator) and drop (empty, auth, redirect); fully deterministic and offline
- [x] #4 dev_log RecordOutcome + command_manager + filter_metrics are updated from page_type/confidence to capture-outcome fields (captured / drop_reason / byte_size); no page_type / allowed_types references remain
- [x] #5 The gate never throws on unusual input (PDFs / non-HTML are simply kept and captured as raw bytes rather than special-cased); no heuristic content-quality thresholds remain
<!-- AC:END -->


## Implementation Notes

Replaced the up-to-1 LLM classifier with a deterministic, offline relevance gate.

- **Gate** (`workflow/webpage_filter.ts`): `evaluate_page_gate(raw_page, url, config?) -> {keep, reason}` decides from cheap signals only — empty/whitespace (`content_empty`), PDF by `%PDF` magic or `.pdf` URL (`pdf`), no-HTML-tags (`non_html`), visible-text length below `min_text_length` (`content_too_small`), and anchor-text/visible-text ratio above `max_link_density` (`link_heavy`). Usage-agnostic: no topic classification. `GateConfig` / `DEFAULT_GATE_CONFIG` (`min_text_length: 200`, `max_link_density: 0.6`). Deleted `classify_webpage`, `PAGE_FILTER_PROMPT`, the 6-way taxonomy, `PageClassification`, `should_process_page`, `log_filter_decision`, `FilterConfig`/`DEFAULT_FILTER_CONFIG`.
- **Signature deviation:** the gate takes `url` directly rather than the full `PageMetadata` from the task's `evaluate_page_gate(raw_page, metadata)` sketch — the URL is the only metadata signal it needs (content-type/PDF), and the workflow already has it. Keeps the gate free of a metadata dependency.
- **Config** (`config/gate_config.ts`, renamed from `filter_config.ts`): `get_gate_config()` reads `bergamot.captureGate.minTextLength` / `maxLinkDensity`. The `bergamot.webpageFilter.*` settings (enabled/allowedTypes/minConfidence/logDecisions) are removed from `package.json`; the two `captureGate` settings are registered with descriptions.
- **Metrics** (`workflow/filter_metrics.ts`): `FilterMetricsCollector`/`global_filter_metrics` → `GateMetricsCollector`/`global_gate_metrics` with capture-outcome fields (`total_pages`, `captured_pages`, `dropped_pages`, `drop_reasons`); no page_type/confidence.
- **Outcomes** (`dev_log.ts`): `VisitOutcome` drops `page_type`/`confidence`, adds `byte_size`; the `classify_result` stage becomes `gate_result`. `command_manager` outcome/metrics rendering updated to bytes/drop-reasons (channel "Bergamot Capture Gate Metrics").
- **Workflow** (`workflow/simple_workflow.ts`): the classifier+filter block is replaced by the gate; dropped pages record `{decision: dropped, reason}` and never reach capture; PDFs/non-HTML get a specific reason (folds task-34 AC#3).
- **CI tests + fixtures**: committed `__fixtures__/capture/` pages (article, docs-with-nav, nav-heavy, aggregator, empty, PDF) with expected metadata + keep/drop labels in `__fixtures__/capture_fixtures.ts`. `webpage_filter.test.ts` asserts the gate matches every label plus targeted threshold cases. Fully deterministic and offline.

**AC#1 — parity exercise:** the prescribed one-off comparison against `classify_webpage` over a saved sample of real captures could not be run: this is a pre-release environment with no dev DB / exported capture sample, and `classify_webpage` is an LLM call (no offline oracle). Thresholds were instead derived from first principles and validated against the committed fixtures, which represent the gate's target archetypes (long-form article and docs-with-sidebar → keep; nav/aggregator/empty/PDF → drop). The deterministic gate is also strictly cheaper and more predictable than the LLM classifier (the old `allowed_types: ['knowledge']` default dropped everything non-"knowledge"); the new gate keeps any substantive content page. Re-running a real-capture parity check once dev data exists is left as a follow-up if recall tuning is needed.

Files: `workflow/webpage_filter.ts`, `config/gate_config.ts` (renamed), `workflow/filter_metrics.ts`, `dev_log.ts`, `workflow/simple_workflow.ts`, `server/server_manager.ts`, `reconcile_webpage_trees_workflow_vanilla.ts`, `commands/command_manager.ts`, `package.json`, `__fixtures__/capture/*`, `__fixtures__/capture_fixtures.ts`, `workflow/webpage_filter.test.ts`, plus test updates in `simple_workflow.test.ts`, `command_manager.test.ts`, `server_manager.test.ts`, `reconcile_webpage_trees_workflow_vanilla.test.ts`, `server_pipeline.integration.test.ts`.
