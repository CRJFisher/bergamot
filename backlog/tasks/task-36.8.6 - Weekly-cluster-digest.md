---
id: TASK-36.8.6
title: Weekly cluster digest cadence
status: Done
assignee: []
created_date: "2026-06-26 00:00"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.8.5
references:
  - backlog/decisions/0001-tdt-cluster-surface.md
parent_task_id: TASK-36.8
---

> **Branch:** all TDT work commits to the `tdt` branch.

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The host-agnostic push anchor for hosts without a panel: run the `bergamot-clusters` skill
on a documented weekly cadence (the Claude Code routine/cron mechanism, e.g. Monday 08:00
local) to surface last week's clusters + coverage and, opt-in, stage a weekly-review stub.
Pull-first and triaged, not a firehose (the notification-fatigue lesson): the staged write
and any desktop notification are opt-in, and a quiet week produces neither. The digest only
READS over the relay — no compute, no DB write — so it does not contradict plan §9's
rejection of OS cron for the clustering rebuild trigger.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 A documented weekly cadence (the routine/cron config IS the cadence; SKILL.md documents it and how to retune)
- [x] #2 Parameterised by window; emits a digest from `recent` + `coverage`
- [x] #3 Staged weekly-review stub and notification are opt-in; a quiet week is silent
- [x] #4 Read-only consumer — does not move compute into the routine (no §9 contradiction)

<!-- AC:END -->

## Implementation Notes

### High-level summary

Documented in `.claude/skills/bergamot-clusters/SKILL.md` ("Weekly digest"): a `/schedule`
routine invokes the skill weekly, which runs `bergamot_clusters.js recent --days 7` +
`coverage --days 7` and summarises the result. The routine you create with `/schedule` is
the operative cadence; SKILL.md documents the default (Monday 08:00) and how to change it.
Pull-first, opt-in writes, quiet on empty weeks.
