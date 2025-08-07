---
id: task-15
title: Add group connection data to visit tracking
status: To Do
assignee: []
created_date: '2025-08-07 08:45'
labels:
  - browser
  - navigation
  - critical
dependencies: []
---

## Description

The browser extension currently doesn't send group connection data (group_id, tab_id, opener_tab_id) to the server, making it impossible to track which tabs belong to the same navigation session. Tabs opened from each other only connect via the unreliable referrer field.

## Acceptance Criteria

- [ ] Extension sends group_id with every visit to group related navigation sessions
- [ ] Extension sends tab_id to identify individual tabs
- [ ] Extension sends opener_tab_id to track parent-child tab relationships
- [ ] Tabs opened from same origin share the same group_id
- [ ] Group connections work even when referrer is missing (e.g. GitHub)
- [ ] E2E tests validate group connection data is sent correctly
