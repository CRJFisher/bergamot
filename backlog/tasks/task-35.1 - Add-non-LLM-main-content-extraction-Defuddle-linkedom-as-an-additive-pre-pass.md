---
id: TASK-35.1
title: >-
  Add non-LLM main-content extraction (Defuddle + linkedom) as an additive
  pre-pass
status: To Do
assignee: []
created_date: '2026-06-04 17:31'
updated_date: '2026-06-04 18:01'
labels: []
dependencies: []
references:
  - vscode/src/workflow/html_reduce.ts
  - vscode/src/workflow/simple_workflow.ts
parent_task_id: TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce extract_essence(raw_html, url) -> PageEssence draft {markdown, title, excerpt, author?, site_name?, published_at?, word_count, lang?, lead_image_url?} using Defuddle via defuddle/node with linkedom as the DOM provider; document Readability + linkedom + turndown as the all-CJS fallback. Verify the ESM-in-CJS integration (dynamic import / esbuild) early — this is the single real integration risk in the epic. Land ADDITIVELY: insert extraction in the pipeline between reduce_html_for_llm and the content-processing LLM call, initially feeding the extractor's clean markdown INTO the existing content-processing call (smaller, cleaner prompt) rather than replacing it, so e2e stays green. Reframe html_reduce as an input-sanitizer / hard-cap fallback for the parser. Absorbs and supersedes task-31.5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 extract_essence(html, url) returns clean markdown + title + excerpt + word_count + optional author/site_name/published_at/lang/lead_image_url
- [ ] #2 extract_essence loads Defuddle via the existing new Function('m','return import(m)') dynamic-import shim (as in claude_agent_client.ts) so it survives ts-jest CommonJS; a smoke test confirms it imports and runs under jest. If that fails, the Readability + turndown CJS fallback is selected and documented with the reason
- [ ] #3 defuddle + linkedom (and, for the fallback, @mozilla/readability + turndown) are added to vscode/package.json dependencies and verified to bundle in the esbuild/CJS output
- [ ] #4 Extraction runs in the pipeline and feeds the existing content-processing call; no LLM step is deleted yet; e2e remains green
- [ ] #5 extract_essence is async; colocated fixture unit tests (article / docs-with-nav / nav-heavy) await it and run green under the existing ts-jest/CommonJS config (no jest ESM transform changes), asserting article isolation and metadata extraction
- [ ] #6 html_reduce is demoted to parser input-sanitizer / hard-cap fallback
<!-- AC:END -->
