---
id: TASK-39.9
title: Bound the dev-observability plaintext side-channels (dev-log + replay ring)
status: Done
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
- [x] #1 A forget deletes dev-log.jsonl and its rotation wholesale when present, and the replay-ring sweep remains covered by tests
- [x] #2 A packaged install with devMode off writes neither dev-log.jsonl nor captures/ — verified, not assumed
- [x] #3 The bergamot.devMode setting description and docs/threat-model.md state that dev observability writes visit URLs to plaintext files
- [x] #4 The dev log has a documented, enforced size/rotation bound
<!-- AC:END -->

## Implementation Notes

## High-level summary

Dev-mode logging existed as the last unsealed plaintext gap in Bergamot's right-to-forget cascade. When a developer enables `bergamot.devMode` (or runs F5), two artifacts accumulate visit URLs on disk outside the encrypted stores: `dev-log.jsonl` (a rolling JSONL file of pipeline-stage events) and `captures/*.json` (a bounded ring of full visit JSONs for pipeline replay). The replay ring was already swept by the cascade; the dev log was not. This task seals that gap and tightens the gate that controls when either artifact is written.

The approach is coarse and intentional. The dev log interleaves events from every visit, so selective URL-by-URL rewriting is not worth building for a dev-only artifact. Instead, the cascade deletes both `dev-log.jsonl` and its rotated `dev-log.jsonl.1` wholesale whenever a forget runs. A new file is simply recreated on the next `dev_log()` append — the privacy guarantee holds at forget time, not continuously. The forget summary exposed to the user now includes dev-log file deletions, so the action is visible.

The four moving parts: `sweep_dev_log(storage_base)` in `right_to_forget.ts` deletes the two files unconditionally and returns a count (0, 1, or 2); `ForgetReport` gains a `dev_log_files_removed` field distinct from `files_removed` (which remains scoped to selector-matched replay captures); `command_manager.ts` includes the new count in its swept summary and "nothing matched" guard; and `docs/threat-model.md` retires the open-gap framing for the dev log.

The F5 gate moves from `!!process.env.BERGAMOT_STORAGE_PATH` to `context.extensionMode !== vscode.ExtensionMode.Production`. This correctly excludes packaged installs from implicit dev-log enablement regardless of what environment variables the user's shell happens to carry. The `should_enable_dev_log(dev_mode, in_development)` predicate is extracted to `dev_log.ts` so the gate is unit-testable — the regression guard (`should_enable_dev_log(false, false) === false`) is the machine-checked proof of the packaged-install guarantee.

Navigation: the cascade lives in `right_to_forget.ts::forget()`; dev-log state and the new `DEV_LOG_FILENAME` constant are in `dev_log.ts`; the gate predicate is `should_enable_dev_log` in the same file. The `purge_outcomes` JSDoc cross-references `sweep_dev_log` for the on-disk counterpart to the in-memory ring purge. The rotation bound (5 MB, one `.1` copy, checked every 200 writes) is enforced in `rotate_if_needed` — documented now in the module header and the threat model; the ~10 MB worst-case is a soft bound because the check is periodic, not per-write.
