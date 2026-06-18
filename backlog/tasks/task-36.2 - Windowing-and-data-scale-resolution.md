---
id: TASK-36.2
title: Windowing and data-scale resolution
status: To Do
assignee: []
created_date: "2026-06-05 19:22"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.1
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Turn the raw visit stream into the bounded time windows HDBSCAN runs over, and resolve the real data scale before fixing defaults. Windows are over webpage_activity_sessions.page_loaded_at (indexed, stored as ISO TEXT). The clustering unit is the page visit; navigation trees are metadata only, never a window boundary.

A calendar window is the default; the load-bearing invariant is a hard page-count guard that keeps each window under the clustering ceiling (~5k samples). When a window overflows the guard, subdivide deterministically: split at the largest inter-visit gaps first, then fall back to calendar bisection. Window bounds must be a pure function of (timestamps, config) so runs are reproducible.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §5 (Windowing strategy).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A documented query of the live DuckDB page_loaded_at distribution determines the default window length and confirms whether the per-window count guard is ever hit; the chosen default is recorded
- [ ] #2 windowing.ts produces window bounds as a pure function of (timestamps, config) — identical inputs yield byte-identical bounds
- [ ] #3 A window exceeding max_samples subdivides deterministically (gap-split, then calendar bisection) and the actual bounds used are recorded per window
- [ ] #4 Sparse windows below min_window_visits are skipped with a 'not enough data' signal rather than producing spurious singletons
- [ ] #5 Unit tests cover boundary determinism, overflow subdivision, and sparse-window skip
<!-- AC:END -->

## Implementation Notes

**AC #1 — window default resolved.**
The scale-check query (plan §5; embedded as a JSDoc comment above `DEFAULT_WINDOW_CONFIG` in `tdt/src/config.ts`) is the instrument for determining the default window length. The live DuckDB is encrypted at rest and held read-write by the extension for its lifetime, so the query runs through the extension's HTTP broker — it cannot be run from the CLI against the encrypted file directly.

Personal single-user browsing produces well under `max_samples = 4000` pages in any calendar month (the busiest months are expected in the low hundreds to low thousands for typical usage), so the per-window count guard is not expected to fire on the default month window. Subdivision (AC #3) is the safety valve for the rare dense burst, not the common path.

**Chosen default: `unit: "month"`, `max_samples: 4000`, `min_window_visits: 8`.** Re-running the query as history grows is a config re-tune, not a code change.

Note: the literal query result against live data is a follow-up — paste actual monthly visit counts into these notes once the extension is running, to confirm the default holds.
