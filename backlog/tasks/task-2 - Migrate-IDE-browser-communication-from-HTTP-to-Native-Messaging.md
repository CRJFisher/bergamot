---
id: task-2
title: Migrate IDE-browser communication from HTTP to Native Messaging
status: To Do
assignee: []
created_date: '2025-07-14'
labels: []
dependencies: []
---

## Description

The current communication between the IDE extension and the browser extension uses HTTP. This should be migrated to use native messaging for better security and performance. The document at 'backlog/docs/native-messaging.md' provides guidance on this.

## Acceptance Criteria

- [ ] Browser extension sends messages to IDE extension via native messaging.
- [ ] IDE extension receives messages from browser extension via native messaging.
- [ ] Existing functionality relying on this communication works correctly.
- [ ] HTTP server in IDE extension is removed.
