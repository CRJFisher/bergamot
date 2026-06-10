---
id: TASK-39.9
title: Bound the dev-observability plaintext side-channels (dev-log + replay ring)
status: To Do
assignee: []
created_date: '2026-06-10 09:57'
labels:
  - security
  - privacy
  - dev-experience
dependencies: []
references:
  - vscode/src/dev_log.ts
  - vscode/src/visit_replay.ts
  - vscode/src/right_to_forget.ts
  - docs/threat-model.md
parent_task_id: TASK-39
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two dev-observability artifacts persist visit URLs in plaintext: `dev-log.jsonl` (+ its rotation) logs per-visit stage lines whenever `bergamot.devMode` is on or F5 debugging sets BERGAMOT_STORAGE_PATH, and the replay ring (`<storage_base>/captures/*.json`) keeps the ~20 most recent full visit JSONs under the same gate. The forget cascade already sweeps matching replay files and purges the in-memory outcome ring, but dev-log.jsonl is never rewritten — a forgotten URL survives in it until the file rotates away. docs/threat-model.md names both honestly as open gaps.

SCOPE (bound, don't gold-plate — these are dev-only artifacts behind a default-off gate): (1) make the forget cascade delete `dev-log.jsonl{,.1}` wholesale when present (coarse but real deletion; selective JSONL rewriting is not worth building); (2) add a retention bound so the dev log cannot grow unbounded across long dev sessions (the rotation exists — verify and document the cap); (3) state plainly in the threat model and the devMode setting description that enabling dev observability writes visit URLs to plaintext files under the storage base; (4) confirm a packaged install never writes either artifact unless the user explicitly enables devMode (the implicit F5 path must not fire on an installed extension).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A forget deletes dev-log.jsonl and its rotation wholesale when present, and the replay-ring sweep remains covered by tests
- [ ] #2 A packaged install with devMode off writes neither dev-log.jsonl nor captures/ — verified, not assumed
- [ ] #3 The bergamot.devMode setting description and docs/threat-model.md state that dev observability writes visit URLs to plaintext files
- [ ] #4 The dev log has a documented, enforced size/rotation bound
<!-- AC:END -->
