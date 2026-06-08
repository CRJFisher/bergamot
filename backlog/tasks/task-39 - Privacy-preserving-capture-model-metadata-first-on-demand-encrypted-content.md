---
id: TASK-39
title: >-
  Privacy-preserving capture model: metadata-first, on-demand encrypted content,
  no ambient caching of sensitive pages
status: To Do
assignee: []
created_date: "2026-06-08 12:10"
labels:
  - privacy
  - security
  - capture
  - architecture
dependencies: []
references:
  - backlog/drafts/privacy-preserving-capture-model.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Reorient bergamot around being privacy-preserving by default — the organizing product principle, governing desktop and mobile capture alike. Today the capture pipeline writes full page HTML (document.body.outerHTML, ~2MB) for every visit to disk. That is unacceptable for the product's privacy promise: a user visiting a sensitive or logged-in page should never have its contents silently cached in a recoverable form.

Full model and rationale: backlog/drafts/privacy-preserving-capture-model.md (read it before starting).

THE MODEL:

- Capture browsing METADATA by default (visit id, URL, timestamp, title, and the session graph: referrer/opener/group ids, SPA navigation events) — the "trail". This is the only thing written ambiently.
- Do NOT archive page CONTENT ambiently. Content is sensitive and is captured only on-demand.
- Any content that is cached on-demand is ENCRYPTED AT REST (key in OS keystore/secure enclave), never plaintext HTML on disk, and is per-page/per-project deletable.
- Sync minimization: metadata syncs by default; content syncs only if the user enabled archiving, over user-owned channels only (see task-37).
- Capture is opt-in; private/incognito excluded; clear UI with pause/exclude/view/delete controls; privacy policy + accurate App Privacy labels.

CENTRAL DECISION TO RECORD (detailed in the design doc):

- Option A: heuristic exclusion of authenticated/sensitive pages + ambient archiving of the rest — rejected unless login/sensitivity detection can be made reliable, because detection is not foolproof and sensitive pages would slip through to disk.
- Option B (RECOMMENDED): no ambient content archiving at all; content is fetched/cached only when the user explicitly pulls a page or trail into a research project. Default disk footprint is metadata only.
- Stricter fallback: archive no content at all; operate on metadata + live re-fetch at use time.

CROSS-CUTTING — this changes shipped behavior and constrains downstream features (no backwards-compat shims; remove the ambient-content path, do not wrap it):

- Desktop capture (task-35, currently ships full-content capture) must move to metadata-default + on-demand content.
- RAG (task-31) and TDT (task-36) assume a content corpus; under this model their searchable content corpus is only the explicitly-archived pages, plus metadata for everything else. They need rescoping against the smaller opt-in corpus (separate follow-up; this task records the impact and the new contract they build against).
- Mobile (task-38) ships metadata-first from day one on this model.

This is a foundational policy + the concrete capture/storage changes to honor it. After the content-archiving decision (AC #1) is recorded, downstream rescoping of RAG/TDT is spun off as follow-up tasks.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 The content-archiving policy is decided and recorded (metadata-first; on-demand vs heuristic-exclusion vs no-archiving), with rationale, and backlog/drafts/privacy-preserving-capture-model.md reflects the chosen policy
- [ ] #2 Default capture writes browsing metadata only (URL, timestamp, title, session graph); no page content is written to disk ambiently, verified by a test that browsing without explicit archiving produces zero cached page content
- [ ] #3 Page content is archived only via an explicit, user-initiated on-demand action (e.g. adding a page/trail to a research project), scoped and revocable
- [ ] #4 Authenticated/sensitive and private/incognito pages are excluded from content archiving by default; archiving such a page requires explicit per-page confirmation
- [ ] #5 Any cached page content is encrypted at rest with the key held in the OS keystore/secure enclave; no plaintext page HTML is written to disk, verified by inspecting on-disk artifacts in a test
- [ ] #6 Cached content is deletable per-page and per-project, and deletion removes the data (verified, not a tombstone)
- [ ] #7 The existing desktop capture pipeline (task-35) is migrated to metadata-default + on-demand content, with the ambient full-content path removed (no compatibility shim)
- [ ] #8 The impact on RAG (task-31) and TDT (task-36) is documented as the new contract they build against (metadata-always + on-demand-archived-content corpus), and follow-up rescoping tasks are created
- [ ] #9 Capture is opt-in with UI controls to pause, exclude sites, view, and delete; private/incognito excluded by default
- [ ] #10 User-facing privacy documentation (what is captured, where it is stored, how it is protected, how to delete) is added
<!-- AC:END -->
