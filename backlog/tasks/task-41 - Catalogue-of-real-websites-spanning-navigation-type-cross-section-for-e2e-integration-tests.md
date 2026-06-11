---
id: TASK-41
title: Catalogue of real websites spanning the navigation-type cross-section for e2e/integration tests
status: To Do
assignee: []
created_date: "2026-06-11 11:55"
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

**Intention-tree node:** CAPTURE — fidelity of the navigation/session graph. The
graph is the durable source of truth UNDERSTAND/SURFACE groups into projects.
Capture correctness is currently exercised only against synthetic fixtures
(`browser/e2e/test_page_server.ts`, `e2e-workflows.html`), which encode the
behaviour we already expect. They cannot surface the ways real sites break our
assumptions: SPA frameworks, referrer scrubbing, redirect bounces, and
address-bar-vs-link transitions. We have no shared, characterised catalogue of
real websites spanning the full range of navigation behaviours to test against.

### What is missing

A maintained catalogue of **real websites, each tagged by the navigation
behaviours it exercises**, that integration/e2e tests can drive. The catalogue is
the reusable artifact; individual tests plug into it rather than each
re-discovering "a site that does X". Behaviour dimensions to span:

- **SPA / history API** — `pushState`/`replaceState` in-app routing
  (e.g. GitHub repo browsing, Gmail, a React/Vue/Next app).
- **Referrer scrubbing** — sites that strip `document.referrer` via
  `Referrer-Policy` or `<meta name="referrer">` (e.g. GitHub).
- **Redirect chains** — `client_redirect` / `server_redirect` bounces
  (link shorteners, OAuth flows, http→https, analytics wrappers).
- **Multi-tab / opener** — `target=_blank`, `window.open`, and `rel="noopener"`
  link patterns.
- **Search / SERP-driven** — query → results → click-through.
- **Bookmark / address-bar / autocomplete** — `typed`, `auto_bookmark`,
  `generated`, `keyword` transitions.
- **News / feed aggregators** — long lists of outbound links.
- **Classic multi-page (MPA)** — full-document navigations as the baseline.

### Shape (to be decided in the task, not prescribed here)

The catalogue should be a structured, declarative manifest (e.g. a typed
data file under `browser/e2e/`) listing each entry's URL or local mirror, the
behaviour tags it covers, and the expected navigation-graph shape (causal edges,
group membership, referrer source). Tests iterate the catalogue and assert the
captured graph matches the expected shape per entry.

**Live-site vs. mirrored fixtures — a real trade-off to resolve in this task:**
driving live third-party sites makes tests flaky, network-dependent, and subject
to the sites changing under us; fully synthetic fixtures lose the realism that
motivates the catalogue. The likely answer is captured/mirrored fixtures
(recorded responses or self-hosted reproductions) that faithfully reproduce each
behaviour while staying deterministic and offline — but the entries must be
traceable to the real sites they characterise so the catalogue stays honest as
the web evolves. Decide and document the policy.

### Why now

This unblocks DRAFT-3 (transition-type referrer gating), whose entire premise is
measuring edge precision/recall across the site-type cross-section — it cannot be
evaluated without this catalogue. It also strengthens the existing capture e2e
suite (`basic_capture`, `cross_tab`, `spa_navigation`, `full_pipeline`) against
real-world navigation patterns rather than only the synthetic ones.

### Destructive-delete plan

Additive: introduces a catalogue artifact and wires existing/new e2e specs to it.
Where a current bespoke fixture duplicates a behaviour the catalogue now covers
(e.g. ad-hoc SPA/cross-tab pages in `test_page_server.ts`), that fixture is
migrated to a catalogue entry and the duplicate removed — no parallel
fixture sources for the same behaviour.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 A structured, declarative catalogue manifest exists (typed data, not prose) where each entry records its URL/mirror, the navigation-behaviour tags it covers, and the expected navigation-graph shape (causal edges, group membership, referrer source)
- [ ] #2 The catalogue spans every behaviour dimension: SPA/history-API, referrer-scrubbing, redirect chains (client + server), multi-tab/opener incl. rel=noopener, search/SERP, bookmark/address-bar/autocomplete, feed aggregators, and classic MPA — with at least one entry per dimension and the gaps logged where a dimension is not yet covered (no silent omission)
- [ ] #3 The live-site-vs-mirrored-fixture policy is decided and documented; entries are deterministic and offline-runnable in CI, and each remains traceable to the real site it characterises
- [ ] #4 At least one integration/e2e spec iterates the catalogue and asserts the captured navigation graph matches each entry's expected shape
- [ ] #5 Existing bespoke capture fixtures that duplicate a catalogued behaviour are migrated to catalogue entries and the duplicates removed
<!-- AC:END -->
