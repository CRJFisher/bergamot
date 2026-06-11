---
id: DRAFT-3
title: Gate referrer edges on webNavigation transition type, evaluated across site types
status: To Do
assignee: []
created_date: "2026-06-11 11:45"
labels: []
dependencies:
  - TASK-41
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

**Intention-tree node:** CAPTURE — fidelity of the navigation/session graph. The
graph is the durable source of truth that UNDERSTAND/SURFACE groups into projects;
false edges in it propagate into topic grouping, so edge precision is load-bearing.

### Current behaviour

The extension reconstructs referrer chains entirely from the privileged
`chrome.webNavigation` + `chrome.tabs` graph in the background service worker — it
makes **zero use of `document.referrer`**. This is a strength: chains survive
referrer scrubbing (GitHub), SPA navigation, cross-origin transitions, and
`rel="noopener"` — all cases where `document.referrer` is stripped or empty.

The capture is broad by design. For every same-tab navigation,
`record_navigation` → `update_tab_history` (`browser/src/background.ts:122`,
`browser/src/core/tab_history_manager.ts:30`) unconditionally shifts the tab's
`current_url` into `previous_url` and records it as the referrer of the new page.

### The gap

`details.transitionType` and `details.transitionQualifiers` from
`webNavigation.onCommitted` are **never consulted** (confirmed: zero usages in
`browser/src`). Because every sequential same-tab page becomes a referrer, the
graph over-asserts causal edges. It cannot distinguish a genuine click-through
from:

- a **typed** address-bar URL (`transitionType: "typed"`)
- a **bookmark** / start page (`"auto_bookmark"`, `"start_page"`)
- an autocomplete/keyword jump (`"generated"`, `"keyword"`)
- a **back/forward** navigation (`transitionQualifiers: ["forward_back"]`)

Concrete failure: read page A, then type an unrelated URL B in the address bar →
B is recorded with referrer = A, manufacturing a click-through that never
happened. This directly erodes the "window into the user's thought process" the
chain was meant to capture.

### The trade-off (why this is evaluation-gated, not a one-line filter)

Naively keeping only `transitionType ∈ {link, form_submit}` risks **dropping
legitimate edges** — the opposite failure. The graph must not be shattered:

1. **Redirect chains.** Many real click-throughs land via redirects (link
   shorteners, OAuth bounces, http→https, analytics wrappers). The committed
   transition for the final URL may be a redirect qualifier, or the edge's true
   source may be an intermediate hop. A blunt filter attaches the referrer to a
   throwaway redirect URL or drops the source→destination edge entirely. Redirect
   chains (`client_redirect` / `server_redirect`) must be collapsed so the real
   edge survives.
2. **SPA events.** `onHistoryStateUpdated` (`background.ts:178`) carries
   transition metadata too, but in-app `pushState` navigations are app-driven and
   their prior-URL chaining is usually legitimate. The gating policy for SPA
   events may need to differ from full-document loads.
3. **Causal edge vs. session continuity are conflated today.** A single
   `previous_url` shift currently encodes both "this page caused that one"
   (causal referrer) and "these pages belong to the same exploration"
   (`group_id` membership). A typed URL or back/forward should likely **cut the
   causal edge but keep the session/group** — the user is still on the same train
   of thought. Tightening the referrer must not fragment `group_id`.

Because the right policy depends on which transition types and qualifiers
actually correlate with real click-throughs — and that varies by site type — it
**must be evaluated over the full cross-section of site types** before any
threshold is committed: SPA-heavy (GitHub, Gmail), redirect-heavy
(OAuth, shorteners), multi-tab research, search-driven, bookmark/address-bar
driven, and news/feed aggregators.

### Proposed direction (to be validated, not assumed)

- Capture `transitionType` + `transitionQualifiers` into `TabHistory` at
  `onCommitted` / `onHistoryStateUpdated` time (currently discarded).
- Split the model into two relationships: a **causal referrer edge** (gated on
  transition) and **session/group membership** (kept broad). Typed / bookmark /
  forward_back cut the edge but stay in the group.
- Collapse `client_redirect` / `server_redirect` chains so the referrer points at
  the real source, not an intermediate hop.
- Build a labelled evaluation corpus across the site-type cross-section and
  measure edge precision/recall under candidate policies. Pick the policy on
  evidence, log what each policy drops (constitution: no silent caps).

### Destructive-delete plan

If adopted, the unconditional `previous_url`-as-referrer behaviour in
`update_tab_history` is replaced, not wrapped — no compatibility flag preserving
the old over-asserting path. The new transition-aware classification becomes the
single authority for edge vs. group.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 `transitionType` and `transitionQualifiers` are captured into the tab-history graph at `onCommitted` and `onHistoryStateUpdated` time (currently discarded), available to referrer computation
- [ ] #2 A labelled evaluation corpus spans the site-type cross-section — SPA-heavy (GitHub/Gmail), redirect-heavy (OAuth/link-shorteners), multi-tab research, search-driven, bookmark/address-bar-driven, and news/feed aggregators — with ground-truth causal edges
- [ ] #3 Edge precision/recall is measured for candidate gating policies against the corpus; the chosen policy is justified by the numbers, and the false-negative rate (legitimate edges dropped) is reported per site type, not just in aggregate
- [ ] #4 Redirect chains (`client_redirect` / `server_redirect`) are collapsed so a referrer edge points at the real source, not an intermediate hop; covered by an E2E spec
- [ ] #5 Tightening the causal referrer edge does not fragment `group_id`: a typed URL / bookmark / back-forward in an existing tab cuts the causal edge while keeping the page in the opener/session group (E2E asserts edge dropped + group retained)
- [ ] #6 The robustness that exists today is preserved and regression-tested: SPA, GitHub-style referrer scrubbing, cross-origin same-tab, and `rel="noopener"` still produce correct causal edges
<!-- AC:END -->
