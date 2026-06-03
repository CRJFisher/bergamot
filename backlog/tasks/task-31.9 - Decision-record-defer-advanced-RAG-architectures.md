---
id: TASK-31.9
title: "Decision record: defer advanced RAG architectures"
status: To Do
assignee: []
created_date: "2026-06-02 12:23"
labels: []
dependencies:
  - TASK-31.1
parent_task_id: TASK-31
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Capture the deliberate deferral (YAGNI) of advanced architectures so they are recorded, not forgotten. Write a decision record under backlog/decisions/ covering GraphRAG (global corpus-wide sensemaking via entity-graph + community-summary map-reduce), Agentic RAG (multi-step reasoning agents), Self-RAG (reflection-token adaptive retrieval, needs custom training), and CRAG (confidence-scored corrective retrieval with web-search fallback). For each: what problem it solves, why it is overkill for a baseline PKM now, and the concrete trigger that should make us revisit it. See backlog/docs/rag-pipeline-upgrade-plan.md (Deferred section).


**Learning companion:** [backlog/docs/rag-explainers/09-deferred-architectures.html](09-deferred-architectures.html) — interactive explainer of the concepts and the decision logic for this phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A decision record under backlog/decisions/ documents GraphRAG Agentic-RAG Self-RAG and CRAG
- [ ] #2 Each entry states the problem solved why it is deferred and the concrete revisit trigger
- [ ] #3 The record links back to backlog/docs/rag-pipeline-upgrade-plan.md
<!-- AC:END -->
