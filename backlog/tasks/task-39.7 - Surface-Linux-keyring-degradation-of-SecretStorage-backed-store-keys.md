---
id: TASK-39.7
title: Surface Linux keyring degradation of SecretStorage-backed store keys
status: To Do
assignee: []
created_date: '2026-06-09 21:00'
labels:
  - security
  - privacy
  - linux
  - storage
dependencies: []
references:
  - vscode/src/database/encryption_key.ts
  - docs/threat-model.md
parent_task_id: TASK-39
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The store encryption keys (metadata store + content cache) are held via VS Code `SecretStorage`, which is cross-platform: Electron `safeStorage` wraps the persisted value with a key from the OS keystore — Keychain on macOS, DPAPI on Windows, libsecret/KWallet on Linux. macOS and Windows are covered out of the box.

The gap: on Linux WITHOUT a functioning keyring (headless sessions, minimal window managers, `--password-store=basic`), Electron silently falls back to a hardcoded-key scheme. `SecretStorage` keeps working — keys store and retrieve, nothing breaks — but the wrapping key is recoverable from VS Code's own files, so the at-rest defense for both encrypted stores degrades to obfuscation against offline file access. The user gets no signal that this happened. docs/threat-model.md names this degradation honestly (Key handling section); this task makes it visible at runtime.

APPROACH (investigate, then implement the cheapest honest signal): an extension cannot query Electron's chosen password-store backend directly. Candidate detections on `process.platform === 'linux'`: probe for `org.freedesktop.secrets` on the session D-Bus; or document the limitation and show a one-time warning on Linux pointing at the threat model when no keyring service is detectable. The warning must be accurate (only when actually degraded), one-time, and dismissible — not nagware. No behavior change on macOS/Windows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On Linux with no functioning keyring backing SecretStorage, the user receives a one-time, dismissible warning that at-rest key protection is degraded, linking docs/threat-model.md
- [ ] #2 No warning fires on macOS, Windows, or Linux with a working keyring (no false positives)
- [ ] #3 docs/threat-model.md's Key handling section reflects the runtime detection once it exists
<!-- AC:END -->
