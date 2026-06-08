# Bergamot Constitution

Privacy is the core organizing principle of Bergamot. Bergamot turns a user's passive browsing into a durable, local-only, queryable knowledge base that surfaces the projects and interests they are actually working on — and it does so by capturing **browsing metadata only, never page content**. It records knowledge-rich page visits automatically (visit id, URL, page-load timestamp, title, and the navigation/session graph), stores that metadata losslessly on the user's own machine as the durable source of truth, and **re-downloads public pages later** to understand them — pages behind a login wall fail to re-download and are thereby excluded. That record is used to show the user what they are working on, seeding their notes rather than presupposing them. This document states the intentions, inviolable promises, operating policy, and scope that govern all work on Bergamot. It is durable and changes rarely.

---

## 1. The Intention Tree

Every task is justified by its place in this tree. The tree is the test a proposed change must pass.

**Root intention:** Turn a user's passive browsing into a durable, local-only, queryable knowledge base that surfaces the projects and interests they are actually working on — capturing metadata only, never content.

The root has three load-bearing children, in sequence:

```
ROOT — local, durable, queryable knowledge base from passive browsing
│
├── CAPTURE  (shipped; metadata-only refactor in progress)
│     Passively, deterministically capture METADATA ONLY: visit id, URL,
│     page-load timestamp, title, and the navigation/session graph (referrer
│     chains, tab-opener relationships, group/session ids, SPA pushState/
│     replaceState events). Zero-LLM, deterministic. Page content is NEVER
│     stored at capture. Browsing metadata is the durable source of truth.
│
├── STORE  (shipped; schema reset in progress)
│     Durable, local-only persistence of the metadata record. DuckDB metadata
│     store + derived stores; there is no raw-content capture row. "Durable"
│     applies to the metadata (not silently mutated or lossy-extracted);
│     content's absence at capture is by design, not lossy extraction — NOT
│     permanent against the user's will (see right-to-forget). Any content
│     cached after re-download is a separate, on-demand, encrypted, scoped,
│     deletable tier — never the source of truth.
│
└── UNDERSTAND / SURFACE  (in progress — the hero loop)
      Post-process re-downloads public page content from the stored URLs
      (login-walled pages fail and are excluded), embeds and groups it into
      the projects the user is actually working on, and pushes them to the
      user as editable note stubs in their PKM. Temporal Topic Detection runs
      first over the re-downloaded public corpus. This is the wedge.
```

Beyond the spine sit the deferred branches. They are real intentions, but each is gated on the spine first proving its value. None is built ahead of its unlock condition.

```
DEFERRED BRANCHES
│
├── (b) Research tools over the archive
│     A constrained, read-only RAG sub-agent that searches the re-downloaded /
│     on-demand content (and its encrypted caches) for relevant inputs to a
│     topic. Runs AFTER Temporal Topic Detection. Extends the topic-digest skill.
│     Unlock: a working retrieval baseline the eval harness validates.
│
├── (c) Note-linking
│     Connect existing notes to relevant visited webpages, linking external
│     ideas to the user's own.
│     Unlock: a bootstrapped note corpus exists to link against.
│
└── (a) Autonomous research agents
      Agents that research on the user's behalf, bounded by a user-defined
      budget. The LAST pillar.
      Unlock: a demonstrated-trustworthy project-surfacing loop, plus the
      full agent-governance suite (Section 3).
```

**The hero loop.** The one workflow that must be delightful before anything else ships: _Bergamot shows you the projects you actually worked on this week, surfaced from your browsing, as editable note stubs in your PKM._ The loop is: browse → Bergamot captures metadata → post-process re-downloads the public pages (login-walled pages excluded) → Temporal Topic Detection drafts a project note (title + member page links + one-line summary) → the user refines it → refined notes become future link targets. Temporal Topic Detection is the critical path. Retrieval quality serves this surface; it is not an independent platform goal.

**Bootstrap, do not presuppose.** Captured metadata seeds the second brain. A surfaced project becomes a note stub the user fills in. Bergamot does not require a populated PKM to be useful — capture is the seed, not the dependency.

---

## 2. Inviolable Principles

These are the promises never traded away. They hold regardless of feature pressure, deadline, or convenience. Each is a hard line, not a default.

1. **Local-only by default.** No captured metadata and no re-downloaded content leaves the machine without an explicit, per-feature, default-OFF consent the user actively granted. Metadata that syncs between the user's own devices travels only over user-owned channels (device-to-device P2P / a synced inbox folder / the user's own iCloud) — never through a developer-controlled server. A hard local-only mode is always selectable, is the state at first run, and disables every cloud model role — forcing local inference or the feature off.

2. **Never capture private browsing.** A tab where `tab.incognito` is true is refused before any capture request is made — no metadata is recorded for it. The user has explicitly signalled "do not remember this," and that signal is honoured absolutely.

3. **Privacy exclusion of content is enforced by the login wall at re-download time, not by an ingestion-time guess.** No page content is stored at capture, so there are no sensitive content-bytes at rest to exclude at ingestion. Content is acquired only later, by re-downloading the page from its stored URL: authenticated and paywalled pages fail to re-download (login redirect / 403 / paywall) and are thereby excluded automatically — no "is this sensitive?" heuristic is needed or trusted. There is no post-authentication content heuristic and no content denylist gate. A user-editable origin list may exist to skip re-download or to suppress metadata capture for an origin, but it is a convenience, not the privacy mechanism. Residual surface, acknowledged: a stored URL is itself metadata that can leak (query strings, tokens, identifiers, the fact of a visit), and is governed by the URL-handling policy in Section 3.

4. **Right-to-forget is real and cascading.** Deleting — by URL, by origin, or by time-range — atomically removes the metadata row AND every derived artifact: any encrypted re-downloaded content cache, all derived vectors, and all cluster memberships. Forgetting is deletion, not hiding: no derived artifact may continue to encode forgotten content. This primitive is part of the core spine, not deferred.

5. **Capture is visible and stoppable.** An always-on capture indicator plus a one-click global pause/kill ship as part of the recorder. A passive recorder the user cannot see or instantly stop is not shippable.

6. **The metadata store is the syncable artifact; re-downloaded content is quarantined.** Metadata is syncable over user-owned channels by design (it is the sync inbox). Any encrypted re-downloaded content cache is quarantined, scoped, and encrypted: it never lives inside a git-tracked or pushable directory, never inside the PKM repo, and never reaches a developer-controlled path. The PKM repo holds only user-authored notes and explicitly-promoted artifacts. This closes the silent-egress path for content.

7. **The local server requires real authentication.** A per-extension capability token, generated at pairing and stored on both sides, is required on `/visit` and on every `/query`, and on any re-download or sync endpoint. Loopback binding is a second layer, not the only one. CORS origin-checking is not authentication and is never treated as such.

8. **Autonomous agents never write to canonical PKM notes.** Agents write append-only to a quarantined staging area the user promotes by hand. Agent-authored content is clearly tagged. The deterministic source of truth is never mutated by an agent.

9. **Agent autonomy is governed by hard enforcement primitives.** A pre-call token-budget meter refuses the next LLM call when the budget is exhausted; a max-iterations cap, a near-duplicate-query halt, and a kill-switch bound every agent that does its own retrieval. The budget is enforcement, not a model-tier price lever.

10. **No uncited assertion.** Every agent-synthesized claim and every proposed note-to-webpage link carries a citation back to a specific metadata row (and the re-downloaded source identified by its URL). A citation references the URL and metadata, **not** a guaranteed byte-for-byte snapshot of what the user saw — re-downloaded content may differ from the as-viewed page (see the content-fidelity open question). Agent output is always auditable against the local source of truth.

11. **No surplus code.** A task is admissible only if it is the cheapest change that advances a named node of the intention tree. If it cannot be tied to a node, it is surplus and is rejected. The tree lives in `CLAUDE.md`.

12. **Documentation describes the system as it is.** Stale-state documentation is treated as a constitution violation — the documentation form of a shim — and is fixed, not tolerated. Docs are the authoritative source of truth about the current system.

---

## 3. Operating Principles (Policy)

These are the tunable defaults and disciplines that govern day-to-day work. They may be adjusted with justification; the inviolables above may not.

### Capture and storage

- **The capture gate operates on metadata only.** After incognito refusal (principle 2), the gate keeps the visit and records its metadata. Empty, auth, and redirect interstitials cannot be judged at capture — there is no content to inspect — so dropping them moves to re-download time, where a fetch that yields a login wall, redirect stub, or empty body is discarded. An optional URL-pattern skip may avoid re-downloading obvious auth/redirect hosts.
- **Retention is two-tiered.** The metadata record defaults to forever and is tunable. The re-downloaded content cache is on-demand, encrypted, scoped, and may carry a shorter or ephemeral retention. The forget _mechanism_ (principle 4) is inviolable for both; the window _lengths_ are policy.
- **At-rest encryption of the metadata store** (OS-keychain-backed key, e.g. VS Code `SecretStorage`; DuckDB native database encryption) is the recommended near-term default. Because metadata is now the durable source of truth, this is a tracked commitment, not optional polish. **Encryption of the re-downloaded content cache is a core, non-deferrable property** of that tier, separable from the quarantine line: quarantine closes the silent-egress path; encryption defends physical and malware compromise.
- **A written threat model is the prerequisite** for the at-rest, authentication, re-download, and metadata-sync decisions: single trusted user, on a possibly-shared or possibly-compromised machine, with hostile local processes in scope.

### Content acquisition (re-download)

- **Content is acquired by re-downloading the stored URL during post-processing**, server-side or on the desktop — never captured at browse time. The login wall is the privacy filter (principle 3).
- **Re-download is the upstream dependency** of every content consumer (Temporal Topic Detection, RAG-prep, image/diagram extraction). It classifies fetch outcomes (ok / auth-redirect / 403 / paywall / dead link) and emits fidelity metadata (`fetched_at`, `http_status`, content hash) so drift and unavailability are visible.
- **Re-download is polite egress.** Rate-limiting, backoff, and retry discipline bound the outbound traffic it creates; the threat model accounts for it as an egress surface.

### Embeddings

- **One shared local embedding model, one embedding pass, is the default** for both RAG and Temporal Topic Detection, computed over **re-downloaded public content**. Divergence into two independent stacks must be earned by a dated, real cross-feature requirement — never assumed for hypothetical decoupling.
- **The clusterable/searchable corpus is the re-downloadable public subset.** Visits whose pages fail to re-download (auth-walled, dead) are excluded from clustering and retrieval; they remain present as trail/metadata only. This is a deliberate coverage choice, not a bug.
- **Every stored vector carries an `embedding_model_id`.** Re-embedding is atomic: build-new, swap, never mix mid-index. A harness regression runs immediately after any embedding swap. The RAG↔TDT shared-space alignment is recorded as explicit tracked debt with a migration test, so the research-tool and note-linking branches are not silently foreclosed by drift.

### Surfacing and the hero loop

- **Surfaced projects are pushed at a habit anchor** — a VS Code panel that opens on launch and/or a weekly notification — not left purely pull. Retrieval _occasion_ is prioritized over retrieval _quality_ for habit formation; the push surface precedes RAG quality polish.
- **A per-cluster control surface ships with the TDT surface on day one** — suppress, rename, never-cluster-this-origin — as a launch-blocking requirement. Suppression persists across recomputes. `never-cluster-this-origin` feeds the capture/skip-re-download list. Correctness alone does not justify unconditional surfacing; the control surface is what converts "surveilled" into "seen."

### Measurement

- **Measurement validity gates merges.** A golden dataset declares its size, a query-sourcing protocol that does not bias toward currently-retrievable pages, a time-based held-out split, and a refresh cadence. Any reported delta clears a bootstrap-CI threshold over queries, not just a point estimate. A measured improvement inside the noise floor is not an improvement.
- **The central TDT claim is measured, not asserted.** A small user-confirmed project-label set (10–20 projects) is scored by cluster purity/completeness against the surfaced clusters, in addition to internal geometry validity. "We surface your projects" is a measured claim or it is not made.

### RAG complexity

- **RAG complexity is eval-driven, not reference-architecture-driven.** Each RAG subtask beyond the eval harness is conditional on the harness showing a metric gap the simpler pipeline cannot close. Reranking and query transformation are build-only-if-the-harness-demands. SOTA technique is justified only where it provably serves the hero loop.

### Scope discipline (YAGNI / no-shims / root-cause)

- **No backwards compatibility, no shims.** No compatibility shims, adapters, wrappers, aliases, deprecated re-exports, or transitional layers. Update all callers to the new pattern; delete what is replaced. Schema changes are destructive resets, not migrations.
- **Fix root causes.** When debugging, keep asking "is this the root cause?" until the answer is yes.
- **Every new task answers three standing questions** at creation time: (1) which intention-tree node does this advance? (2) is this the cheapest change that advances it? (3) what is the destructive-delete plan for what it replaces?

### Cloud (opt-in only)

- **Cloud LLM RAG-prep is a default-OFF, opt-in tunable** — for contextual-retrieval summarization, query transformation, and the digest — available only after the local-only path and consent flow exist. Cloud egress touches only already-public re-downloaded content (login-walled pages are excluded before this stage), which materially lowers the stakes. **Anthropic (Haiku default) is the single optional provider.** A second cloud vendor is surplus egress surface and is not added.

---

## 4. What Bergamot Is Not

Anti-goals. These are out of scope permanently, not "not yet."

- **Not a content recorder.** It never stores page HTML/text at capture. Content is re-downloaded from public URLs on demand; pages behind a login wall are never recorded.
- **Not a screen recorder of private sessions.** It never captures incognito or private-browsing tabs — not even their metadata.
- **Not a cloud product.** Captured metadata and re-downloaded content are never sent to any cloud API by default or without explicit, per-feature consent, and never through a developer-controlled server. No cloud-scale, multi-tenant, or server-hosted storage of user data. Storage is local, single trusted user; cross-device metadata sync is user-owned-channel only.
- **Not multi-vendor.** User content is never routed to a second cloud vendor. One optional provider is the ceiling.
- **Not a content-syncing archive.** Metadata is intentionally syncable over user-owned channels; what is forbidden is syncing raw or cached **content** into a git-tracked / syncable directory, and running a developer-controlled sync/storage server.
- **Not a self-mutating note system.** Autonomous agents never write directly into canonical user-authored PKM notes.
- **Not a money leak.** No agent ships with only a soft model-tier price lever. A hard pre-call budget meter and kill-switch are required.
- **Not "secured" by CORS.** Origin-checking is never treated as authentication for the local server.
- **Not a duplicated embedding platform.** No two permanent independent embedding stacks without a dated, real cross-feature requirement.
- **Not SOTA for its own sake.** Reranking, query transformation, and similar complexity are never built as ends in themselves for a single-user corpus, unjustified by a measured eval gap.
- **Not a vanity claim.** "We surface your projects" is never asserted on internal geometry proxies alone, with no human-judged cluster-quality metric.
- **Bergamot is a personal/portfolio tool that works for its owner first.** This sets the scope ceiling against which "surplus" is judged. It is not a marketplace product, and SOTA/production-grade work is justified only where the harness proves the simpler pipeline insufficient for the hero loop.

---

## 5. Scope: Now / Later / Never

### Now — the minimum habit-forming loop and the trust contract it rests on

- Write the intention tree into `CLAUDE.md`: root sentence, the three load-bearing children (Capture → Store → Understand/Surface), the deferred branches named with unlock conditions, and the verbatim admissibility rule from principle 11.
- Fix stale-state docs to describe the metadata-only + re-download system: the README, the `docs/architecture/*` and `backlog/docs/*` pipeline docs, and `WORK_PRIORITY.md`. Delete docs that describe removed subsystems rather than maintaining them. Add a Definition-of-Done decision record committing to the personal/portfolio scope, and a decision record for the privacy-core reorientation.
- Metadata-only capture: refactor the capture path so no page content (HTML/text) is captured or stored; title/URL/load-timestamp come directly from the tab; drop the `content_compressed` BLOB as a destructive schema reset.
- Upstream privacy: incognito refusal at capture; the login wall as the content-exclusion mechanism at re-download. No ingestion-time content denylist or post-auth heuristic.
- The re-download / post-processing content fetcher: read metadata rows, re-download public pages, classify and exclude failures, emit fidelity metadata — the upstream dependency for TDT and RAG.
- Visible capture indicator + one-click global pause/kill.
- Quarantine and encrypt the re-downloaded content cache out of the syncable PKM repo; add the per-extension capability token on `/visit`, `/query`, and re-download/sync endpoints; write the threat model doc.
- At-rest encryption of the metadata store (OS-keychain-backed key).
- Cascading right-to-forget primitive (by URL / origin / time-range) across metadata rows → encrypted content cache → vectors → cluster tables, built into the core spine.
- Correct the README's local-only claims and ship the hard local-only mode (default at first run) that disables every cloud role.
- Temporal Topic Detection as the hero-loop critical path, over the re-downloaded public corpus: one shared local embedding model, `embedding_model_id` stamping + atomic re-embed, a per-cluster control surface (suppress / rename / never-cluster-origin), and a 10–20 project user-labeled set scored by purity/completeness.
- The eval harness with the measurement-validity clause (size, unbiased query-sourcing, time-split, refresh cadence, bootstrap-CI gating); each later RAG subtask conditional on a shown metric gap.
- PKM write-back: turn a surfaced project into an editable note stub (title + member page links + one-line summary).
- Push the weekly project surface at a habit anchor (VS Code panel on launch and/or notification), before RAG quality polish.

### Later — earned by the spine proving value

- Cloud LLM RAG-prep (Anthropic Haiku) as an opt-in, default-OFF tunable — only after the local-only path and consent flow exist, and only over already-public re-downloaded content.
- Research-tool RAG sub-agent over the re-downloaded / on-demand content (branch b): a constrained, single-tool, read-only retrieval surface extending the digest-skill shape, running after TDT.
- Note → webpage linking (branch c), once the bootstrapped note corpus exists to link against.
- Autonomous research agent (branch a), gated behind a demonstrated-trustworthy project-surfacing loop: unit of work = one surfaced cluster; append-only to quarantined staging; with the full governance suite (pre-call budget meter, max-iterations, near-duplicate halt, kill-switch, no-uncited-assertion). Before building it, measure incremental re-embed + clustering recompute cost to confirm whether local compute, not tokens, is the binding constraint.
- Individual RAG subtasks (hybrid, chunking/contextual retrieval, reranking, query transformation, embedding selection, time-aware), each earned by a harness-measured gap, over the re-downloaded corpus.
- Mobile capture (metadata-only) syncing to the user's own desktop over user-owned channels.
- Incremental re-embedding cache + recompute-cadence policy, after the compute-cost probe.
- Deduplication (canonical-URL on metadata; content-hash on re-downloaded content) and page-type tagging (SERP / feed / aggregator) as reversible RAG-prep flags to protect retrieval and clustering quality.
- Cross-window cluster stability tracking and a window-over-window stability metric in the validation harness.
- Cold-start as a first-class experience: emerging-thread surfacing below `minClusterSize` with low-confidence framing; cold-start queries in the golden set.

### Never

- Storing page content (HTML/text) ambiently at capture time.
- Capturing incognito / private-browsing tabs, or recording metadata for them.
- Running a developer-controlled sync or storage server for user data by default.
- Sending captured metadata or re-downloaded content to any cloud API by default or without explicit per-feature consent.
- Routing user content to a second cloud vendor.
- Storing raw or cached content inside the git-tracked / syncable PKM repo.
- Autonomous agents writing directly into canonical user-authored PKM notes.
- Shipping an agent with only a soft model-tier price lever and no hard pre-call budget meter / kill-switch.
- Treating CORS origin-checking as authentication for the local server.
- Two permanent independent embedding stacks without a dated, real cross-feature requirement.
- Building SOTA RAG complexity as an end in itself, unjustified by an eval-measured gap, for a single-user corpus.
- Claiming "we surface your projects" on internal geometry proxies alone.
- Cloud-scale / multi-tenant / server-hosted storage of user data.

---

## 6. Open Questions

These are genuinely unresolved and are decided when the dependent work is reached, not before.

- **Re-download fidelity.** A re-downloaded page is not guaranteed to equal the as-viewed page: dynamic/JS-rendered content, dead links, paywall/consent drift, A/B variants, and edits over time all diverge. How drift is detected (`fetched_at` + content hash + status) and what is surfaced to the user when content cannot be faithfully recovered is decided when the fetcher is hardened.
- **URL-as-metadata handling.** Even with content excluded, a stored URL for a sensitive page can leak (query strings, tokens, identifiers, the fact of the visit). Whether the origin skip-list becomes a never-store-metadata list, and what URL scrubbing/redaction policy applies, is decided with the fetcher and gate work.
- **Metadata-sync channel and semantics.** P2P vs synced inbox folder vs the user's own iCloud — conflict resolution, dedup, and ordering across devices, and the additional threat surface — are decided when cross-device sync is built.
- **Re-download execution location and politeness.** Whether re-download runs server-side or on the desktop, and the rate-limit/backoff/robots discipline, follow from the fetcher design and the compute-cost probe.
- **Binding constraint on autonomy.** Whether local compute (embedding + clustering recompute on the constrained dev machine) or LLM tokens is the binding constraint on autonomous agents is unknown. It is measured — by extending the data-scale probe to recompute cost — _before_ the agent is built, so the right resource is governed.
- **Cluster stability stance at the surface.** Determinism (same input → same output) is delivered; stability (small input change → small output change) is not. Whether the surface gates to closed/immutable windows, pulls a minimal stability metric forward, or accepts and messages churn as a known limitation is decided when the surface is hardened, informed by measured churn.
- **Recompute cadence and vector-cache strategy** follow directly from the compute-cost probe above.

---

## 7. Amendment

This constitution is durable and changes rarely. It is amended only by an explicit, recorded decision that names which principle or scope line changes and why. Inviolable principles (Section 2) are the highest bar: an inviolable is not relaxed silently, by a feature task, or by convenience — only by a deliberate amendment that the user authors. Operating policy (Section 3) and scope (Section 5) may shift as the spine proves value and the open questions resolve; those shifts are recorded as decision records, not edits made in passing. When this document and the code disagree, that is a bug in one of them, to be fixed at the root — never papered over.
