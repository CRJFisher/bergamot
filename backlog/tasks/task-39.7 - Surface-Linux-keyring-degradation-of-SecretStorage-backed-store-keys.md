---
id: TASK-39.7
title: Surface Linux keyring degradation of SecretStorage-backed store keys
status: Done
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
- [x] #1 On Linux with no functioning keyring backing SecretStorage, the user receives a one-time, dismissible warning that at-rest key protection is degraded, linking docs/threat-model.md
- [x] #2 No warning fires on macOS, Windows, or Linux with a working keyring (no false positives)
- [x] #3 docs/threat-model.md's Key handling section reflects the runtime detection once it exists
<!-- AC:END -->

## Implementation Notes

## High-level summary

The gap was that on Linux without a functioning OS keyring, Electron's `safeStorage` silently falls back to a hardcoded wrapping key — both encrypted stores (metadata and content cache) appear to work normally while at-rest protection degrades to obfuscation. Nothing throws; the user sees no signal. This task makes that state visible at activation time.

The detection probes the Secret Service over the session D-Bus (`dbus-send Peer.Ping` to `org.freedesktop.secrets`, 1.5 s timeout). Exit 0 means a real keyring answers; anything else — ENOENT (no `dbus-send`), timeout, non-zero exit — resolves to `"degraded"`. Non-Linux platforms short-circuit to `"available"` before spawning anything.

The warning fires on exactly one path through activation: Linux platform, dismissed flag not set, probe returns `"degraded"`. It is a one-time notification with two buttons: "Learn more" opens `docs/threat-model.md` via `markdown.showPreview` and then persists the dismissed flag; "Dismiss" persists the flag directly. Closing via X does not persist the flag — the warning re-appears next activation on a still-degraded machine. The `globalState` flag survives across sessions so a genuinely-dismissed warning stays quiet permanently. The probe never runs after the first dismissal.

The implementation lives in `vscode/src/database/linux_keyring.ts` alongside `encryption_key.ts`, since both concern the at-rest key protection layer. The module exports two functions: `linux_keyring_status()` (the probe, also directly testable) and `maybe_warn_linux_keyring(context)` (the orchestrator). The call site in `extension.ts` is a single fire-and-forget `void` call after `get_or_create_store_key` — the warning is about the quality of protection for a key that already exists. `docs/threat-model.md` §A Key handling gained one sentence folding in the runtime detection.

The probe is a proxy, not a perfect signal: a user could force `--password-store=basic` while GNOME Keyring is running, and the probe would see the keyring and stay silent (a rare false negative). This residual gap is documented in the companion (`detection-plan.html`) and accepted — the warning fires only when no keyring is detectable, so it is never nagware; the false-negative case would leave the user unwarned but is already honestly described in the threat model.

The link to `docs/threat-model.md` works in the dev workspace (where `extensionUri/../docs/` resolves to the repo root). In a packaged install the file is not bundled; "Learn more" fails silently in that case and dismissal is not persisted, so the warning re-appears on the next activation rather than silently going away.

Fifteen colocated tests cover the probe outcomes (available, degraded, ENOENT, timeout, double-settle guard) and the warning orchestration (already dismissed, working keyring, both buttons, X-close, doc-open failure).
