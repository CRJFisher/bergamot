---
id: TASK-31.12
title: 'RAG use-case: scheduled "topic digest" Claude skill over visited pages'
status: To Do
assignee: []
created_date: "2026-06-05 19:22"
labels: []
dependencies:
  - TASK-31.8
  - TASK-31.11
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Prove the RAG pipeline end-to-end with a real downstream consumer: a custom Claude skill that, run on a schedule, surfaces the relevant webpages the user has visited in a given topic over a recent time window and produces a digest.

The skill is a thin orchestrator over the MCP retrieval surface built in the earlier sub-tasks — it does no retrieval of its own. Given a topic (or a small watchlist of topics) and a time window, it calls the single `semantic_search` MCP tool with the topic as the query, an optional `time_range` (e.g. the last week, anchored to "now"), and `time_reranked` enabled so recently-visited pages on-topic rise to the top. It then renders the top hits — with their citations (source URL + chunk) returned by task-31.8 — into a short markdown digest ("This week in <topic>: pages you visited, summarised, with links"). The same skill, invoked without a `time_range`, exercises the non-time-based path for an all-time "what have I read about X" query.

Scheduling reuses the existing Claude Code routine/cron mechanism (e.g. a weekly run); the skill is parameterised by topic(s), window, and schedule, and writes the digest as a markdown artifact (and optionally a desktop notification). This is the use-case that justifies the whole pipeline and is portfolio-grade proof that ingestion → chunking → hybrid+rerank → time-aware retrieval → MCP citations composes into something a user actually wants. It also serves as an integration test: a regression in any upstream phase shows up as a degraded digest.

This sub-task runs last in the task-31 sequence, after the MCP surface (task-31.8) and time-aware retrieval (task-31.11) are in place.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A custom Claude skill (SKILL.md + script) exists that, given a topic and an optional time window, calls the semantic_search MCP tool and returns the relevant visited pages with their citations (source URL)
- [ ] #2 The skill drives the time-based path (semantic_search with time_range + time_reranked) for "recent pages on topic X" and the non-time-based path (no time_range) for all-time topic search
- [ ] #3 The skill is runnable on a schedule via the documented routine/cron config, parameterised by topic(s), window, and cadence
- [ ] #4 Each run produces a markdown digest artifact grouping the surfaced pages under the topic with links/citations and a short summary per page
- [ ] #5 The skill degrades gracefully (clear "nothing relevant this window" output, no error) when no pages clear the relevance floor in the window
- [ ] #6 The skill is documented with at least one worked example demonstrating the end-to-end RAG pipeline against Bergamot's own store
<!-- AC:END -->
