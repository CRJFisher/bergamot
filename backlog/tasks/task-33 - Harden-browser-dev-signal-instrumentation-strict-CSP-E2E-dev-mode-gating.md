---
id: TASK-33
title: Harden browser dev-signal instrumentation (strict-CSP E2E + dev-mode gating)
status: To Do
assignee: []
created_date: '2026-06-04 12:09'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The leiden CSP capture bug was fixed by moving zstd compression from the content script to the background service worker and adding browser-relayed dev signals (capture_attempted/capture_failed/compression_failed -> /dev_signal -> dev-log.jsonl). Two follow-ups from the opus review were deferred so the fix could land: an end-to-end regression test for strict-CSP pages, and gating the per-page capture_attempted beacon so it does not add an extra POST per page in production.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An E2E spec serves a fixture page with header 'Content-Security-Policy: script-src ''self''' (no wasm-unsafe-eval) and asserts a /visit with non-empty decompressible content still reaches the server
- [ ] #2 The capture_attempted beacon does not fire an extra /dev_signal POST per page when dev-log is disabled, while still working in the F5 dev session (server advertises dev_log_enabled via /status; background caches it and gates forward_dev_signal)
- [ ] #3 Optionally: mock server records /dev_signal payloads so a test can assert capture_attempted is followed by http_received for the same visit_id
<!-- AC:END -->
