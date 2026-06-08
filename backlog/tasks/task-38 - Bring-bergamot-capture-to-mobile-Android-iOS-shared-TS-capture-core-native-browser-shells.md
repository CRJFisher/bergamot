---
id: TASK-38
title: >-
  Bring bergamot capture to mobile (Android + iOS): shared TS capture core +
  native browser shells
status: To Do
assignee: []
created_date: "2026-06-08 11:36"
labels:
  - mobile
  - architecture
  - capture
dependencies:
  - TASK-37
  - TASK-39
references:
  - backlog/drafts/mobile-port-research-and-architecture.md
  - backlog/drafts/privacy-preserving-capture-model.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Bring bergamot's browsing-capture to mobile so phone browsing feeds the user's trail/session graph (and, via re-download during post-processing, their research corpus). Mobile browsers support neither extensions nor a localhost server, so capture must live inside a browser app the project ships and sync to the user's own storage.

The general approach is settled; the remaining work is one decision gate plus implementation. Full research, architecture, and the open decisions with trade-offs live in the design doc: backlog/drafts/mobile-port-research-and-architecture.md (read it before starting).

PRIVACY-FIRST CAPTURE (per task-39, backlog/drafts/privacy-preserving-capture-model.md): the mobile app captures browsing METADATA only (URL, timestamp, title, session graph) — never page content. Page content is acquired later by re-downloading the stored public URL during post-processing per task-39, and any re-download cache is encrypted at rest. The privacy mechanism is the login wall at re-download — authenticated/paywalled pages fail to re-download and are excluded automatically — not a per-page user action. This is not optional polish; it is the core product posture and what makes the app defensible at store review.

AGREED ARCHITECTURE: one shared, platform-agnostic TypeScript capture core (metadata + session-graph capture, SPA detection, sync client — derived from the desktop browser/ content.ts + background.ts + api_client.ts logic) injected on both platforms, wrapped by two thin native browser shells (Android/Kotlin, iOS/Swift). The mobile core captures metadata only and never archives page content on the device; content is re-downloaded from the stored public URL during post-processing per task-39. Do NOT duplicate capture logic per platform. The native shells provide only transport, tab/window lifecycle, full-page-load boundaries, and UI. All navigation detection (including SPA pushState/replaceState) is standardised in the shared JS core, because Safari's webNavigation lacks onHistoryStateUpdated.

OPEN DECISIONS (the main remaining work, detailed with trade-off tables in the design doc):

- Android engine: System WebView (lightest update burden, symmetric with iOS, but engine-version fragmentation) vs. GeckoView embed (one pinned engine + rich native nav events, heavier dependency, asymmetric injection via a bundled built-in WebExtension). Current lean: start with System WebView; keep GeckoView as an isolated upgrade path. Forking Chromium (Cromite/Brave) is rejected — it means owning a security-rebase treadmill.
- iOS approach: WKWebView-based app (recommended — full control of injection + navigation, reuses the shared core) vs. Safari Web Extension (partial fit, webNavigation SPA gap). Non-WebKit engines are EU-only and effectively unshipped, so not a universal option.

PREREQUISITES: this depends on the privacy model (task-39, which defines metadata-first + on-demand encrypted content) and the user-owned sync transport (task-37, which moves metadata visits to the user's own desktop/iCloud via P2P/inbox-folder/CloudKit, with a developer relay only as an optional fallback). A phone has no localhost server, so the desktop's localhost POST path is replaced by the task-37 sync transport. The visit metadata format is reused from the desktop pipeline.

DISTRIBUTION: metadata-first capture synced to the user's own devices is a minimal, defensible data footprint (potentially "Data Not Collected" at App Store review when sync is device-to-device). It still requires opt-in consent, a privacy policy, and accurate App Privacy labels (browsing history is sensitive). Google Play prominent-disclosure still applies; sideload/F-Droid remains the lower-friction Android channel.

This is a multi-PR initiative. After the engine/approach decision (AC #1) is recorded, spin off implementation subtasks (shared core extraction, Android shell, iOS shell, sync integration) under this parent.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A design decision is recorded selecting the Android engine (System WebView vs. GeckoView) and the iOS approach (WKWebView vs. Safari Web Extension), with trade-offs and rationale, and backlog/drafts/mobile-port-research-and-architecture.md is updated to reflect the chosen paths
- [ ] #2 A shared, platform-agnostic TypeScript capture core exists (metadata + session-graph capture, SPA detection, sync client) and is the single source of capture logic reused by both platform shells — capture logic is not duplicated in Kotlin or Swift
- [ ] #3 Both apps capture browsing metadata (URL, timestamp, title, session graph) by default and write no ambient page content, per the privacy model (task-39)
- [ ] #4 The Android app captures full-page and SPA navigations and syncs metadata visits to the user-owned destination via the task-37 transport
- [ ] #5 The iOS app captures with parity to Android (SPA detection handled in the shared JS core) and syncs metadata visits to the user-owned destination via the task-37 transport
- [ ] #6 Capture parity is verified by a test: the same page produces equivalent metadata visit payloads across the Android engine (Blink) and iOS (WebKit)
- [ ] #7 Neither app archives page content on the device; page content is re-downloaded from the stored public URL during post-processing per task-39, where the login wall excludes authenticated/paywalled pages and any cache is encrypted at rest
- [ ] #8 The task-37 sync transport replaces the localhost POST path, with offline queueing, and is covered by tests
- [ ] #9 A distribution plan is documented covering the metadata-first privacy posture and App Privacy labels, Android prominent-disclosure + sideload/F-Droid, and iOS App Store review risk (and the EU-only alternative-engine constraint)
- [ ] #10 User-facing and developer documentation for the mobile apps and the shared capture core is added
<!-- AC:END -->
