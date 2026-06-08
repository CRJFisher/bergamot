---
id: TASK-34
title: 'Workflow: handle empty/degraded content and non-JSON LLM responses cleanly'
status: To Do
assignee: []
created_date: '2026-06-04 15:56'
updated_date: '2026-06-05 08:59'
labels: []
dependencies:
  - TASK-39.2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The classification/analysis workflow throws 'No valid JSON found in response' for some pages and records them as 'failed', rather than dropping cleanly or degrading. Under the privacy-core model, empty/degraded content arises at RE-DOWNLOAD time (task-39.2 fetcher): a login redirect, 403, paywall, dead link, or a JS-only page can yield little or no usable content, after which the LLM analysis step gets near-empty input and returns prose instead of JSON. This handling belongs in or immediately after the fetcher, where each outcome is classified (ok / auth-redirect / 403 / paywall / dead) — auth-walled/failed visits are excluded as trail/metadata only and never reach analysis.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When re-downloaded content is empty/whitespace or the fetch was an auth-redirect/403/paywall/dead link, the visit is dropped with a clear reason (e.g. content_reduced_empty / auth_redirect / fetch_failed) instead of entering analysis and failing
- [ ] #2 When an LLM response contains no valid JSON, the failure is recorded with the offending stage and a snippet of the response (not just 'No valid JSON found in response'), and does not crash the workflow
- [ ] #3 PDFs and other non-HTML captures either parse or are dropped with a specific reason, never silently 'failed'
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARTIALLY ABSORBED by task-35. AC#1 (empty/whitespace content dropped with content_reduced_empty) folds into task-35.4; AC#2 (non-JSON recorded with stage+snippet, no crash) folds into task-35.7's fallback; AC#3 (PDF/non-HTML dropped with a specific reason) folds into task-35.8's gate. If all three are covered when task-35 lands, close this task; otherwise keep only the residual.

UPDATE (privacy-core reorientation, task-39): capture makes ZERO LLM calls and stores metadata only, so none of these failures occur at capture. They surface during post-processing over re-downloaded content: AC#1 (empty content) and the auth-redirect/403/paywall/dead-link outcomes are handled at the task-39.2 fetcher's outcome classifier; AC#2 (non-JSON LLM response) and AC#3 (PDF/non-HTML) belong to the RAG pipeline's LLM steps (task-31) that run over re-downloaded content.
<!-- SECTION:NOTES:END -->
