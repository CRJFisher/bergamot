---
id: TASK-36.8.3
title: Note-stub renderer + staging writer (the backbone)
status: Done
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.8.1
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The PKM-native backbone: topic clusters become agent-authored markdown stubs written ONLY
into a quarantined `bergamot.staging/` directory (constitution principle 8), promoted by
hand. A pure renderer (`note_stub.ts`) turns a `ClusterDetail` into a markdown document —
frontmatter (`bergamot_agent_authored`, `run_id`, `generated_at`, lineage key, fingerprint,
window bounds, keyphrase tags), an H1, a scope/time line, a one-line summary, and a "Pages
in this thread" list whose member links each carry a machine-matchable
`<!-- bergamot:cite page_session_id=… url=… -->` citation comment. A writer
(`staging_writer.ts`) owns the filesystem effects (gitignore, write); the vscode-dependent
workspace discovery lives in `staging_root.ts`. Reachable host-agnostically via
`POST /stage_cluster`.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 Pure renderer producing the pinned stub anatomy with citation comments; exemplar pinned first
- [x] #2 Writes only into `bergamot.staging/`; auto-gitignore (`*`) so the dir is never committed
- [x] #3 Workspace discovery with a `bergamot.staging.path` override; null when no workspace and no override
- [x] #4 Colocated tests for the renderer and the writer

<!-- AC:END -->

## Implementation Notes

### High-level summary

`vscode/src/tdt/note_stub.ts` (pure) renders the stub and exposes
`compute_lineage_key` / `compute_stub_fingerprint` / `parse_citations`.
`vscode/src/tdt/staging_writer.ts` (pure `fs`, so it is safe in the headless
`server_standalone` bundle) writes the file and the `.gitignore`. The vscode-only
`resolve_staging_root` lives in `staging_root.ts` and is threaded into `ServerConfig`. The
`POST /stage_cluster` route calls `get_cluster` then `stage_note_stub`. Settings:
`bergamot.staging.path` added to `package.json`. Tested in `note_stub.test.ts` and
`staging_writer.test.ts`. Idempotency + the forget sweep are TASK-36.8.4.
