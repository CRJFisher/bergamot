# ADR 0001 — The user-facing surface for topic clusters

**Status:** Accepted · **Date:** 2026-06-26 · **Task:** TASK-36.8 · **Branch:** `tdt`

Temporal Topic Detection produces topic clusters with a 36.5 label bundle
(`headline_title`, `scope`, `keyphrases`, `display_label`, an exemplar page,
`representation_version`). This record decides how a user sees and acts on them.

## Decision

A **two-layer split**: one thin integration primitive over the cluster tables, and
several user-facing surfaces that consume it. The surfaces **layer** — they are not
mutually exclusive — with the hero loop and the launch-blocking controls deliberately
kept off the one host-locked surface.

The raw-MCP-tools pattern (three `list_topic_clusters` / `get_topic_cluster` /
`list_clusters_for_page` tools over `/query/topic_*` routes) is **rejected** as the
primary surface: it makes the database schema the UX — opaque run-id/hash keys,
retained-history double-surfacing read as instability, leaked DB encodings each consumer
must re-derive, and a triple-edit tax (ListTools + CallTool + route) per capability. The
prior scope of this task is retired.

## AC#1 — Candidate evaluation and the layering

Three candidate surfaces, scored 1–5 (5 best) on the named criteria:

| Surface | PKM vis. | Action. | Host port. | Impl. cheap. | Privacy | Role |
| --- | --- | --- | --- | --- | --- | --- |
| Integration primitive | 2 | 4 | 5 | 4 | 5 | the contract every surface needs |
| Note-stub write-back → `bergamot.staging/` | 5 | 4 | 5 | 2 | 4 | **backbone** (hero loop) |
| Claude skill over scripts | 2 | 5 | 5 | 4 | 5 | **actionability** + drives stubs + controls |
| VS Code webview | 4 | 3 | 1 | 2 | 5 | optional accessory (Wave 1 only) |

No single surface wins every column — which is why they layer. **Host portability** is
the column that decides the launch critical path: the primitive, the write-back, and the
skill all score 5; the webview alone scores 1, so it lands off the launch path. The
recommendation:

- **Backbone** — note-stub write-back to `bergamot.staging/`: a markdown note in the
  user's own vault, surfaced ambiently by their file-watcher; the most PKM-native surface
  and a pure filesystem write, so it ports to every host.
- **Actionability** — the `bergamot-clusters` Claude skill: answers in-context recall,
  drives stub generation (`summarise → draft stub`), and is the host-agnostic home for the
  controls and the weekly digest.
- **Controls** — launch-blocking suppress / rename / never-cluster-origin, shipped via the
  skill + a control route so they work on every host. (Suppress/rename take effect on read
  now; the never-cluster-origin preference is recorded now, and the filter that excludes the
  origin from re-download and clustering input is wired by the orchestration work, TASK-36.9.)
- **Accessory** — a VS Code webview: the richest ambient surface for VS Code users, but
  host-locked, highest-cost, and explicitly NOT on the launch critical path.

## AC#2 — The integration-primitive contract

`vscode/src/tdt/cluster_reads.ts` is the **only** surface-facing code that JOINs
`topic_run` × `topic_cluster` × `topic_cluster_member` (+ `webpage_*` for page fields).
Four pure `(db, params) → JSON` functions, each filtered to the live (`status='complete'`)
run and clamped by `MAX_QUERY_LIMIT`:

- `list_clusters_in_range(from, to, limit)`
- `get_cluster(id)`
- `list_clusters_for_page(page_session_id)` → `{ clusters, page_status }`,
  `page_status ∈ {clustered, noise, unseen}`
- `window_coverage(from, to)`

It returns plain JSON (no MCP/HTTP/VS Code types). It binds in-process (the webview, the
stub writer) or behind four `/query/cluster*` routes over the loopback relay (the skill) —
`(db, port.json) → JSON` is identical either way. Its natural home is the standalone
Bergamot daemon that `deploy-to-pkm-platforms.md` extracts; today the same functions live
on the extension's Express server and bind unchanged post-extraction.

**Raw-tools retirement.** The routes are `/query/clusters`, `/query/cluster`,
`/query/clusters_for_page`, `/query/cluster_coverage` — explicitly NOT `/query/topic_*`,
and there are NO MCP `ListTools`/`CallTool` cases for clusters. No half-built `topic_*`
routes ever existed, so the retirement is purely about not creating them; plan §9 is
rewritten to describe the primitive and to **preserve** the separate Stage-1 bulk read
(`GET /query/visits_in_window`), which feeds clustering, is not a user surface, and belongs
to the orchestration work (TASK-36.9).

**Divergence recorded.** The pre-build investigation assumed `scope` needed pinning to
structured `(domain, count)` pairs. The as-built 36.5 labeler already produces a
display-ready string (e.g. `"nextjs.org, github.com +3 sites"`). The primitive therefore
surfaces `scope` **verbatim** — no re-parsing, no invented shape (YAGNI; describe the
system as it is). `representative_vector` is never selected — an internal tracking input
with no surface consumer.

## AC#3 — PKM workflows → surface

| Workflow | Primary surface | Access | Primitive call |
| --- | --- | --- | --- |
| Weekly review | skill digest + staged weekly stub | read | `list_clusters_in_range(last 7d)` |
| Note seeding / Maps-of-Content | note-stub write-back | read-write → staging | `get_cluster(id)` |
| In-context recall while writing | skill | read | `list_clusters_for_page` / `list_clusters_in_range` |
| Dormant-thread resurfacing | skill (scheduled push) | read | `list_clusters_in_range` over an older/wider window |
| Cluster-boundary curation | skill + control route | read-write → control | reads current clusters; writes suppress/rename/never-cluster-origin |
| Drill-down / page provenance | skill (and webview accessory) | read | `get_cluster(id)` |

Every primary surface on the launch path is host-agnostic; the webview attaches as a
Wave-1 accessory only. Multi-window reads (`(from, to)`, not "latest run") are a hard
requirement — dormant-thread resurfacing reads across historical windows.

## AC#4 — Privacy guarantees and the read/write decision

The constitution forces a **read/write asymmetry** on every surface:

- **Toward the PKM — read-mostly.** The only PKM write is the note stub, written
  append-only into a quarantined `bergamot.staging/` directory (constitution principle 8),
  promoted by hand, agent-tagged. No signal is read back from the user's edits — a rename
  or move is **not** treated as an approval (brittle, and skirts the principle-8 boundary).
  "Append-only" governs the canonical-note boundary, not per-file immutability: the agent
  re-writing its own un-promoted draft is permitted and required by idempotency; once
  promoted, the agent never re-touches it.
- **Toward Bergamot's own state — read-write, in scope now.** Cluster-boundary curation
  (suppress / rename / never-cluster-origin) writes to a new `topic_cluster_control` table
  in the encrypted metadata store. This is **launch-blocking** (constitution §3) and is NOT
  a principle-8 PKM write.

**Store invariants honored.** Surfaces read derived metadata only (never a second source of
truth). The clusterable corpus is the re-downloadable public subset by design, so reads
never expose login-walled content. Staging is plaintext where the file-watcher sees it, so
it is defended by quarantine-by-directory + never-canonical + auto-gitignore (`*`), not
encryption. Right-to-forget cascades to all of it: cluster memberships and page-anchored
controls are deleted inside the metadata transaction; staged stubs are swept on the
filesystem by the `<!-- bergamot:cite … -->` citation key (or, for a time-range forget, by
frontmatter-window overlap — the privacy-safe over-delete). **`never_cluster_origin`
controls deliberately survive forgets** — a block on a site is a preference, not
page-derived state.

**Stable-identity decision.** The per-run cluster id (`hash(run_id | local_label)`) rotates
on every recompute, so a control row cannot key on it. Suppress/rename anchor on the
cluster's **exemplar page** (a stable `page_session_id`) plus a **content signature** of the
label as a secondary matcher for when the exemplar churns; a control matches a cluster if
either matches. This favours "suppression persists across recomputes" (constitution §3) at
the small risk of a generic-label signature matching an unrelated cluster — accepted for
v1; `lifeline_id` (a Phase-4 seam) is the clean fix. Note-stub filenames use the same
lineage idea: ISO-week + a slug of the label, so a re-run of a thread overwrites its own
stub rather than spawning a duplicate.

## AC#5 — Decomposition

The decision decomposes into eight follow-on implementation sub-tasks (TASK-36.8.1 …
TASK-36.8.8). **v1 (the launch critical path)** is 36.8.1–36.8.7; the webview (36.8.8) is
deferred. See those task docs for detail and status.

| # | Sub-task | v1 |
| --- | --- | --- |
| 36.8.1 | Cluster read primitive (`cluster_reads.ts`) | ✅ |
| 36.8.2 | `/query/cluster*` routes + retire §9 raw-tool scope | ✅ |
| 36.8.3 | Note-stub renderer + staging writer (the backbone) | ✅ |
| 36.8.4 | Staging idempotency + right-to-forget filesystem sweep | ✅ |
| 36.8.5 | The `bergamot-clusters` skill | ✅ |
| 36.8.6 | Weekly digest cadence | ✅ |
| 36.8.7 | Cluster-control table + write route (launch-blocking) | ✅ |
| 36.8.8 | VS Code webview cluster dashboard | deferred (post-launch accessory) |

## Consequences

- Surfaces ship independently and per-host: the contract is a JSON shape, not a table
  shape. A webview can ship for VS Code without the skill; the skill ships over the relay
  for any host without the webview; the write-back is a pure filesystem op usable
  everywhere.
- The hero loop and the launch-blocking controls never depend on the one host-locked,
  most-expensive surface.
- One residual is accepted: until `lifeline_id` lands, a cluster whose label changes
  across a recompute can spawn a second stub / lose a suppression binding. The fingerprint
  gate and ledger bound the churn; the next run re-curates.

## References

- `backlog/tasks/task-36.8 - MCP-surface-for-topic-clusters.md` and the
  `task-36.8.concept-*.html` companions (the investigation this record synthesizes).
- `backlog/drafts/tdt-hdbscan-micro-tier-plan.md` §9 (rewritten).
- `backlog/drafts/deploy-to-pkm-platforms.md` (daemon extraction, Wave 0–4).
- `docs/constitution.md` principles 4 / 6 / 7 / 8 / 12, §3.
