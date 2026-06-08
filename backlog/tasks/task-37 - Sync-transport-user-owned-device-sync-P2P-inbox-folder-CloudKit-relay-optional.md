---
id: TASK-37
title: >-
  Sync transport: user-owned device sync (P2P / inbox-folder + CloudKit);
  developer relay optional
status: To Do
assignee: []
created_date: "2026-06-08 11:40"
labels:
  - sync
  - privacy
  - mobile
  - backend
dependencies:
  - TASK-39
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - backlog/drafts/mobile-port-research-and-architecture.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Provide the sync transport that moves captured visits from a capture client (the mobile apps, task-38; optionally a second desktop) to the user's own storage — privacy-first, with NO developer-controlled server by default. This replaces the earlier "cloud backend as hard prerequisite" framing: data syncs device-to-device under the user's control, and a developer relay is demoted to an optional fallback.

Governed by the privacy model (task-39): metadata syncs by default; page content is re-downloaded (and optionally cached) during post-processing per task-39, and any cached content syncs only if the user enabled it, and only encrypted. Full model: backlog/drafts/privacy-preserving-capture-model.md. Mobile context: backlog/drafts/mobile-port-research-and-architecture.md.

KEY ARCHITECTURAL INSIGHT — reuse the existing file inbox: the desktop server already persists visits to a file-based inbox directory before acknowledging, and its VisitQueueProcessor ingests from there. So a capture client does not need to POST to any server — the shared capture core writes visit files locally, and a user-owned sync replicates them into the desktop's existing inbox, where the existing pipeline (decompression, validation, queue, DuckDB storage) consumes them unchanged. This largely removes the need for a new ingestion server.

TRANSPORT BY PLATFORM:

- Android / desktop-to-desktop: device-to-device P2P (Syncthing-style) or a synced inbox folder. Background services are allowed on Android, so continuous sync is viable. Visit files replicate into the desktop inbox.
- iOS: continuous background P2P fights iOS background-execution limits. Use the user's OWN iCloud (CloudKit private database) as the user-owned transport — review treats this favorably — or a background URLSession upload to a user-owned endpoint. Record the chosen approach.
- Developer relay: OPTIONAL fallback only, for sync when the desktop/peer is offline or for multi-device without a reachable peer. Not a prerequisite. If built: authenticated, TLS, self-hostable, carries metadata by default and only E2E-encrypted content, and REUSES the existing visit-processing pipeline rather than reimplementing ingestion.

This is the strongest privacy posture: with device-to-device sync the developer holds no user data, supporting a minimal App Privacy footprint (potentially "Data Not Collected").

OUT OF SCOPE: the mobile apps (task-38) and the capture/storage policy itself (task-39). This task is the transport only.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A user-owned sync path moves captured visits from a mobile client to the user's desktop with no developer-controlled server: the client writes visit files that replicate (P2P / synced folder) into the existing desktop inbox directory, and the existing VisitQueueProcessor ingests them unchanged
- [ ] #2 Only metadata is synced by default; page content is re-downloaded (and optionally cached) during post-processing per task-39, and any cached content is synced only when the user has enabled it, encrypted in transit and at the destination
- [ ] #3 An iOS transport works within iOS background-execution limits (user's own iCloud / CloudKit private database, or background URLSession), and the chosen approach is recorded
- [ ] #4 Sync is eventually-consistent and resilient to the desktop/peer being offline — visits queue locally and sync when a peer is reachable, with no data loss across app or device restart
- [ ] #5 Ingestion is idempotent: visit files are unique per visit-id, so replication never produces duplicate or conflicting visits
- [ ] #6 If a developer relay is implemented, it is optional (not on the mobile critical path), authenticated, TLS, self-hostable, metadata-by-default + E2E-encrypted-content-only, and reuses the existing visit-processing pipeline
- [ ] #7 Setup/pairing UX for connecting a phone to the user's desktop or iCloud is documented
- [ ] #8 Tests cover replication-into-inbox ingestion, offline-then-reconnect sync, idempotent dedup, and metadata-only-by-default behavior
- [ ] #9 Documentation for the sync transport (topology, what syncs, encryption, setup) is added
<!-- AC:END -->
