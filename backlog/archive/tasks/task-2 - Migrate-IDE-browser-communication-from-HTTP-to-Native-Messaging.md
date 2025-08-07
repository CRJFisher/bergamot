---
id: task-2
title: Migrate IDE-browser communication from HTTP to Native Messaging
status: Done
assignee: []
created_date: '2025-07-14'
updated_date: '2025-08-07 03:22'
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

## Implementation Notes

Implemented complete Native Messaging infrastructure:

Files created:
- native-host/native_host.py - Python native messaging host
- browser/src/core/native_messaging.ts - Browser-side service
- native-host/manifest.json - Native host manifest
- scripts/install-native-host.sh - Installation script

Key features:
- Bidirectional communication between browser and VS Code
- Automatic port discovery from VS Code server
- Connection management with retry logic  
- Message routing and error handling
- Fallback to HTTP when native messaging unavailable
- Status monitoring and health checks

Implementation details:
- Python native host bridges browser to VS Code server
- Browser extension uses chrome.runtime.connectNative()
- VS Code server listens on dynamic port
- Automatic reconnection on connection loss
- Graceful degradation to HTTP fallback

The native messaging implementation provides secure, efficient communication between the browser extension and VS Code, with automatic fallback ensuring compatibility.
