---
id: task-20
title: Remove hardcoded aggregator filtering from webpage_tree.ts
status: To Do
assignee: []
created_date: '2025-08-08 08:39'
labels: []
dependencies: []
---

## Description

The current implementation has a hardcoded list of aggregator URLs in webpage_tree.ts that are filtered out when creating new trees. This should be replaced with LLM-based detection so the system can intelligently identify aggregator sites without maintaining a static list.

## Acceptance Criteria

- [ ] Hardcoded aggregator URL list removed from webpage_tree.ts
- [ ] LLM-based aggregator detection implemented as one of the webpage categories
- [ ] System correctly identifies and handles aggregator sites using LLM classification
- [ ] Tests updated to verify LLM-based aggregator detection
