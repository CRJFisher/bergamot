---
id: TASK-34
title: "Workflow: handle empty/degraded content and non-JSON LLM responses cleanly"
status: To Do
assignee: []
created_date: "2026-06-04 15:56"
updated_date: "2026-06-04 17:33"
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The classification/analysis workflow throws 'No valid JSON found in response' for some pages and records them as 'failed', rather than dropping cleanly or degrading. Observed on a PDF in the original pre-change session and on pages whose content arrived empty (e.g. when compression had failed upstream), where the LLM analysis step gets little/no content and returns prose instead of JSON. This is independent of the leiden CSP/compression fix and predates it.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 When reduced content is empty/whitespace, the visit is dropped with a clear reason (e.g. content_reduced_empty) instead of entering analysis and failing
- [ ] #2 When an LLM response contains no valid JSON, the failure is recorded with the offending stage and a snippet of the response (not just 'No valid JSON found in response'), and does not crash the workflow
- [ ] #3 PDFs and other non-HTML captures either parse or are dropped with a specific reason, never silently 'failed'
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->

PARTIALLY ABSORBED by task-35. AC#1 (empty/whitespace content dropped with content_reduced_empty) folds into task-35.4; AC#2 (non-JSON recorded with stage+snippet, no crash) folds into task-35.7's fallback; AC#3 (PDF/non-HTML dropped with a specific reason) folds into task-35.8's gate. If all three are covered when task-35 lands, close this task; otherwise keep only the residual.

<!-- SECTION:NOTES:END -->
