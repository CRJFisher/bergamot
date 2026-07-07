---
id: TASK-44.8
title: "Cross-cutting: fix stale docs, write the IA rule down, extend mechanical enforcement"
status: To Do
assignee: []
created_date: "2026-07-07"
labels:
  - ia
  - docs
  - enforcement
dependencies:
  - TASK-44.1
  - TASK-44.2
  - TASK-44.3
  - TASK-44.4
  - TASK-44.5
  - TASK-44.6
  - TASK-44.7
references:
  - README.md
  - docs/constitution.md
  - scripts/check_naming_conventions.ts
  - browser/src/core/server_discovery.ts
  - vscode/src/server/server_manager.ts
parent_task_id: TASK-44
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The IA review's cross-cutting findings: the functionality-not-class rule is written nowhere and enforced nowhere, and two docs are stale (a constitution principle 12 violation). Runs last so enforcement never fires on offenders that still exist and the README describes the final layout.

**Scope**

1. **README truth** (canonical, self-contained style):
   - `README.md:218` claims embeddings use all-MiniLM-L6-v2; the code pins `Xenova/bge-small-en-v1.5` (`vscode/src/tdt/embedding_config.ts:22`). Fix the claim.
   - The Project Structure section omits the `tdt/` workspace and `skills/`. Describe the post-remodel layout.
2. **Write the IA rule down** where tasks are judged against it (a short section in `docs/constitution.md` operating policy, or a decision record referenced from it): _a file lives with the feature that consumes it, types live with the code they describe, a folder exists only when a functionality has ≥2 files; class-of-code names (utils, types, models, core, helpers, shared, common) are verboten as folders and as split-off suffix files._
3. **Extend `scripts/check_naming_conventions.ts`**:
   - Cover `tdt/src` (currently scanned: only `vscode/src` and `browser/src`).
   - Add a check that fails on class-of-code folder names and file basenames (the verboten list above) so the remodel cannot regress.
4. **`SERVER_PORT_RANGE` duplication** — defined independently in `browser/src/core/server_discovery.ts:8` and `vscode/src/server/server_manager.ts:64`, sync'd only by a comment. Browser cannot import from vscode, and a shared package for one constant is surplus; the cheapest mechanical guard is a repo-level check (in the naming-conventions script or a tiny sibling check) that parses both constants and fails on mismatch. Executor picks the cheapest reliable form.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 README names the actual embedding model and a project structure that matches the repo, including tdt/ and skills/
- [ ] #2 The functionality-not-class rule exists in a durable doc that task admissibility can cite
- [ ] #3 check_naming_conventions covers all three workspaces and fails on verboten class-of-code names; running it on the post-remodel tree is clean
- [ ] #4 A mechanical check fails when the browser and vscode port ranges diverge

<!-- AC:END -->
