# Bergamot Privacy Reorientation — Master Update Plan

Canonical plan for migrating the whole repo from the old capture model ("raw HTML stored losslessly at capture = the durable source of truth") to the privacy-core model: **metadata-only capture + re-download during post-processing, where the login wall is the privacy filter.** Produced from a 6-region repo audit (106 findings) plus an adversarial completeness pass. Corrections from that pass are folded in.

## 1. Bottom line

Privacy was already bergamot's stated north star; what changes is the **mechanism**, not the goal. The repo today encodes the old mechanism across the constitution, README, architecture docs, the live capture/storage path (browser `outerHTML` → zstd → DuckDB `content_compressed` BLOB), and every downstream task. The new model inverts it: **capture is metadata-only** (visit id, URL, load timestamp, title, navigation/session graph) and **that metadata is the durable source of truth**; page content is **re-downloaded later**, where **authenticated/paywalled pages fail to fetch and are thereby excluded** — retiring the ingestion-time sensitivity denylist + post-auth heuristic. Downstream: **TDT runs first** over re-downloaded public content, **RAG after**, any cached content is **encrypted + on-demand + deletable**, and metadata **syncs over user-owned channels** with no developer server by default.

Order of execution: the **constitution changes first** (every other artifact derives authority from it; its amendment clause requires a user-authored change), the empty **`CLAUDE.md`** gets the new intention tree, then **code/schema** follow as a clean destructive reset (no-backwards-compat rule), and the **keystone new piece — a re-download/post-processing fetcher — must land with or before the stored-content read path is deleted.**

## 2. Two correctness fixes from the completeness pass (decide these first)

1. **Title/URL/timestamp are captured directly at capture; only `<meta>`-derived fields move to re-download.** The browser has `tab.url`, `tab.title`, and the load time without any page body. Do **not** push title into the lossy re-download tier. Only author / published-at / lang / site_name (parsed from `<meta>`) come from the re-downloaded page. The raw audit slightly conflated "no HTML at capture" with "no title at capture" — it's wrong; title is guaranteed-available metadata.
2. **Empty/auth/redirect interstitial dropping moves to re-download time.** Those drops currently read the page body, which no longer exists at capture. So the capture gate keeps **only incognito refusal** (plus optional URL-pattern skips); empty/transient/auth filtering happens when the fetcher tries to re-download. Don't promise capture-time empty/transient drops — the gate can't see content anymore.

## 3. Constitution amendment proposal (centerpiece — user-authored per §7 amendment clause)

Target: `docs/constitution.md`. Current → proposed, with severity.

- **Preamble [CRITICAL]** — drop "stores them losslessly"; lead with "Privacy is the core organizing principle." Capture is metadata-only; public pages re-downloaded later; login-walled pages excluded.
- **Intention Tree → CAPTURE node [CRITICAL]** — "Raw HTML stored losslessly as the source of truth" → "capture metadata only (visit id, URL, load timestamp, title, navigation/session graph); NEVER store page HTML/text at capture; **browsing metadata is the durable source of truth**." The "knowledge-rich" gate now judges metadata only.
- **Intention Tree → STORE node [CRITICAL]** — "DuckDB raw capture" → "DuckDB metadata store; no raw-content capture row. Content's absence at capture is by design, not lossy extraction. Any re-downloaded content cache is a separate, on-demand, encrypted, scoped, deletable tier — not the source of truth."
- **"Durable source of truth" global redefinition [CRITICAL]** — = the metadata record, everywhere. Content is re-derived and never canonical.
- **UNDERSTAND/SURFACE node + hero loop [HIGH]** — insert the re-download step: browse → capture metadata → post-process re-downloads public content (login-walled excluded) → **TDT first** → draft note → **RAG after**.
- **Principle 1 (local-only) [HIGH]** — reinforced; add: metadata syncs over user-owned channels with no developer server by default (distinct from content egress).
- **Principle 3 (sensitivity exclusion) [CRITICAL — keystone change]** — rewrite from "ingestion-time denylist + post-auth heuristic before bytes hit storage" to "**privacy exclusion is a re-download-time property enforced by the login wall.** No content exists at capture, so there are no sensitive content-bytes at rest; at re-download, authenticated pages fail and are excluded — no heuristic needed. The post-auth heuristic is removed; the denylist may be repurposed as a never-store-metadata / skip-re-download list or dropped." State the residual: a stored URL for a sensitive page is a smaller, new privacy surface.
- **Principle 4 (right-to-forget) [HIGH]** — cascade now covers metadata row + encrypted re-download cache + vectors + cluster memberships.
- **Principle 6 (quarantine) [HIGH — inversion]** — metadata is syncable by design (the sync inbox); the **encrypted re-download content cache** is the thing quarantined/encrypted and kept out of git-tracked/developer paths.
- **Principle 10 (no uncited assertion) [MEDIUM]** — citation references a metadata row + the URL, **not a guaranteed byte-for-byte snapshot** (add the content-fidelity caveat here).
- **Principle 11 + "tree lives in CLAUDE.md" [HIGH]** — reinforced but VIOLATED: `CLAUDE.md` is 0 bytes. Populate it with the NEW tree.
- **Principle 12 (docs as-is) [LOW but the lever]** — the README claims, old nodes, and Principle 3 gate are themselves stale-state violations this principle demands fixing.
- **Operating/Scope lines [HIGH→LOW]** — gate drops sensitivity step (line 97); split retention into metadata (forever) vs re-download cache (on-demand/ephemeral) (98); promote content-cache encryption toward a core property (99-100); upstream privacy gate (157) loses denylist+post-auth, keeps incognito; quarantine lines (159-160) retarget the cache; README correction + TDT-first (161-162); Scope-Never (182-192) adds two lines: "Never store page CONTENT ambiently at capture" and "Never run a developer-controlled sync/storage server by default."
- **CLAUDE.md [CRITICAL]** — write the new tree (CAPTURE=metadata-only, metadata=source of truth; STORE=metadata + encrypted on-demand cache; UNDERSTAND=re-download via login-wall → TDT first → RAG) + the verbatim admissibility rule. Must NOT encode the old model.
- Add a **decision record** (`docs/decisions/privacy-core-reorientation.md`) capturing the Option-C choice and why (keeps history out of canonical docs).

## 4. Repo-wide update plan — grouped and ORDERED

### Group A — Constitution & CLAUDE.md (first)

- [ ] CRITICAL `docs/constitution.md` — all §3 amendments
- [ ] CRITICAL `CLAUDE.md` (0 bytes) — new intention tree + admissibility rule
- [ ] MEDIUM `docs/decisions/privacy-core-reorientation.md` — decision record

### Group B — README / user docs

- [ ] CRITICAL `README.md` — tagline, Why, Overview, Key Features (Capture/Store/Query), Usage, Architecture bullets: metadata-first; drop "stored losslessly = source of truth" (the single most contradictory public claim is the Store feature); add a Privacy section near the top
- [ ] HIGH `README.md` Core Components + MCP tools — extension captures metadata only; `get_webpage_content` may be unavailable for login-walled/dead pages (fidelity caveat)
- [ ] LOW `docs/CHROME_EXTENSION_DEBUGGING.md`, `browser/README-original.md` (second README with content claims), `CONTRIBUTING.md` (minor)

### Group C — Design docs (architecture HTML + backlog/docs)

- [ ] CRITICAL `docs/architecture/{index,storage,page-processing,rag-pipeline,browser-extension,vscode-extension}.html` — `page-processing.html` ("a page can never be re-captured") is the strongest single contradiction; remove the zstd/content path everywhere; add downstream re-download → TDT → RAG stage
- [ ] HIGH `docs/architecture/mcp-and-query.html` — content tools serve re-downloaded content; `/visit` no longer carries zstd content
- [ ] CRITICAL `backlog/docs/{browser-extension-functionality,browser-extension-api-reference,mcp-rag-architecture,dev-db-reset,query-interface}.md` — remove content field / zstd / stored-content-corpus assumptions
- [ ] HIGH `backlog/docs/{browser-extension-code-analysis,rag-pipeline-upgrade-plan,overhaul-roadmap,purge-plan-and-roadmap-to-release}.md` + `rag-explainers/05-clean-ingestion.html` — insert re-download stage; reconcile TDT-first
- [ ] HIGH add a canonical **privacy-core architecture doc** the others point to
- [ ] MEDIUM/LOW `local-dev-loop-plan.md`, `rag-explainers/index.html`, `mcp-tools-usage.md`, time-aware explainer, chunk-size eval doc, `native-messaging.md` (already stale)

### Group D — Capture/storage code + schema + tests (destructive reset; no shims)

Browser (stop ambient content capture):

- [ ] CRITICAL `browser/src/core/data_collector.ts` — delete `extract_page_content`, `MAX_CONTENT_BYTES`, `compress_content`; build metadata-only payload (keep title/url/timestamp from tab)
- [ ] CRITICAL `browser/src/types/navigation.ts` — remove `content` from `VisitData`; fix call sites
- [ ] HIGH delete `browser/src/core/visit_compression.ts`; remove compression wiring in `browser/src/background.ts` + `@hpcc-js/wasm-zstd` dep
- [ ] LOW `browser/src/content.ts`, `browser/src/core/message_router.ts` — comments → metadata-only

Server/storage (stop decompress+store; drop BLOB; add re-download read path):

- [ ] CRITICAL `vscode/src/server/server_manager.ts` — remove decompress block + `MAX_DECOMPRESSED_BYTES`; stop populating raw content; drop `@mongodb-js/zstd`; reduce body limit; `/query/capture_content` → on-demand re-download (login-wall filter)
- [ ] CRITICAL `vscode/src/duck_db.ts` — drop `content_compressed`/`content_encoding`/`original_byte_size`; remove BLOB write + `get_webpage_capture_bytes`; **clean destructive schema reset**, no migration
- [ ] CRITICAL `vscode/src/workflow/store_capture.ts` — remove html compression/storage; persist metadata only
- [ ] HIGH `vscode/src/workflow/page_capture_pipeline.ts`, `vscode/src/visit_queue_processor.ts`, `vscode/src/duck_db_models.ts`, `vscode/src/mcp_server_standalone.ts` — remove `raw_content`/`content` threading; content tools re-download
- [ ] HIGH `vscode/src/workflow/read_metadata.ts` — move `<meta>`-parsing (author/published/lang/site_name) to re-download time; remove its capture-time invocation (title still from tab)
- [ ] HIGH `vscode/src/orphaned_visits.ts` — `OrphanedVisit.visit` drops `raw_content`
- [ ] MEDIUM `vscode/src/workflow/page_gate.ts` — keep incognito refusal; empty/auth/redirect drops move to re-download; optional URL-pattern skip
- [ ] MEDIUM `vscode/src/visit_replay.ts` — store no page bytes (metadata-only replay or drop, YAGNI)
- [ ] LOW `vscode/src/page_capture_models.ts`, `CAPTURE_SELECT` — drop `original_byte_size`; doc strings

Tests & fixtures (rewrite/delete to the metadata-only contract — DO NOT shim to keep green):

- [ ] CRITICAL `vscode/src/server/server_pipeline.integration.test.ts` — asserts "raw page round-trips losslessly" + imports zstd; → metadata POST + mocked re-download
- [ ] CRITICAL `vscode/src/workflow/store_capture.test.ts`, `browser/tests/data_collector.test.ts`, `browser/tests/visit_compression.test.ts` (delete) — all test the removed BLOB/compression
- [ ] HIGH `vscode/src/{duck_db,server_manager,visit_queue_processor,orphaned_visits*,page_capture_pipeline,capture_eval}.test.ts` — strip `raw_content` coupling
- [ ] HIGH `vscode/src/workflow/__fixtures__/capture/*.html` — obsolete (`auth.html`/`redirect.html` test superseded heuristics); remove or repurpose for re-download tests
- [ ] MEDIUM `scripts/run-pipeline-e2e.mjs` — capture step posts metadata + exercises re-download

Package metadata (Principle 12 stale-state surfaces):

- [ ] MEDIUM `vscode/package.json` keyword `webpage-capture` + descriptions; `bergamot.showCaptureMetrics` label; forward surface: the Chrome `manifest.json` store-listing description at package time

### Group E — Tasks & drafts (fix drafts first; tasks reference them)

- [ ] CRITICAL `backlog/drafts/privacy-preserving-capture-model.md` — rewrite to Option C as canonical (drop A/B framing); login-wall = filter; encrypted on-demand cache; user-owned sync; TDT-first; fidelity caveat
- [ ] HIGH `backlog/drafts/tdt-hdbscan-micro-tier-plan.md` — embedding input = re-downloaded public content (not stored HTML); TDT runs first; fidelity caveat
- [ ] HIGH `backlog/drafts/mobile-port-research-and-architecture.md` — reconcile to Option C; drop the shared-core "on-demand content archiving (outerHTML)" capability + 2MB-HTML verification (content is re-downloaded server/desktop, not captured on device)
- [ ] MEDIUM `tdt-temporal-topic-architecture.md`, `draft-1`/`draft-2` (local page classification — over re-downloaded content or moot if it was ingestion-time sensitivity gating)
- [ ] CRITICAL `backlog/tasks/task-39` — rewrite to Option C: content re-downloaded automatically server/desktop (not per-page user action); references the fetcher task as its implementation; AC#4 = login wall is the filter (drop heuristic; keep incognito); keep encryption/forget ACs reframed as the re-download cache
- [ ] HIGH `task-36` + `task-36.3` (corpus = re-downloaded public content; add fetcher dep; TDT-first), `task-31.5` (clean ingestion over re-downloaded HTML), `task-32` (image extraction at re-download time; drop "og:image at capture"), `backlog/WORK_PRIORITY.md`
- [ ] MEDIUM `task-31.3`, `task-31.1`, `task-34` (degraded content now arises at re-download), `task-37`/`task-38` (content re-downloaded, not user-archived)
- [ ] LOW `task-31.11`, `task-31.12`, `task-36.{4,5,6}`
- [ ] `backlog/archive/tasks/task-35*` — no edit (history); it's the prior state being replaced

### Group F — Memory

- [ ] MEDIUM `memory/task35-zero-llm-capture.md` — add a forward note: reorientation makes capture metadata-only; the raw-page write/read paths are slated for removal

## 5. New tasks to create

- **CRITICAL — Re-download / post-processing content fetcher** (the keystone). Reads metadata rows lacking content, re-downloads from the stored URL, classifies failures (auth redirect / 403 / paywall / dead link) and excludes them as the privacy mechanism, emits fidelity metadata (`fetched_at`, `http_status`, content hash / drift markers), and produces the public-content corpus for TDT then RAG. **Upstream dependency of task-31.\*, task-32, task-36.3, and must land with or before the Group D read-path deletion** (else `get_webpage_content` returns nothing with no replacement). task-39 references this task for the mechanism — one source of truth.
- **CRITICAL — Constitution + CLAUDE.md amendment** (lands first; user-authored).
- **CRITICAL — Capture-path metadata-only refactor + schema reset** (Group D code/schema/tests as one destructive change, no shims).
- **HIGH — Encrypted on-demand re-download content cache** (OS-keystore key, scoped, deletable, quarantined; integrates with right-to-forget). See also: encrypt the **metadata store** itself — DuckDB native encryption (needs `@duckdb/node-api` bump 1.2.x → ≥1.4.0) with the key in VS Code `context.secrets`/SecretStorage; metadata is now the source of truth, so this is a near-term commitment.
- **HIGH — Rescope TDT (task-36/36.3)** and **RAG-prep (task-31.\*, task-32)** to the re-downloaded corpus (may fold into task edits).
- **MEDIUM — Doc-sweep** for Group B/C stale-state docs + the canonical privacy-core architecture doc.

## 6. Open questions / risks

1. **Re-download fidelity (flag prominently).** A re-downloaded page ≠ the as-viewed page: dynamic/JS-rendered content, dead links, paywall/consent drift, A/B variants, edits over time. Citations reference URL/metadata, not a snapshot. Decide drift detection (`fetched_at` + content hash + status) and what's surfaced when content can't be recovered.
2. **Re-download egress, cost, politeness.** Outbound traffic to visited URLs is an egress/fingerprint surface. Rate-limit, backoff, robots, cache aggressiveness, and server-side vs desktop execution are undecided.
3. **URL-as-metadata sensitivity.** A stored URL for a login-walled page can itself leak (query strings, tokens, identifiers, the fact of the visit). Does the repurposed denylist become never-store-metadata-for-origin? URL scrubbing policy?
4. **Metadata-sync semantics.** P2P vs inbox-folder vs iCloud — conflict resolution, dedup, ordering across devices; a new threat-model surface.
5. **TDT/RAG coverage gap.** The clusterable/searchable corpus is now a **subset** (public, re-downloadable). Decide: exclude auth-walled/failed visits entirely, or cluster them on metadata-only signals (title/URL/timing)? Affects coverage and noise metrics.
6. **Cache encryption: core vs deferrable.** Promote re-download-cache encryption to a non-deferrable core property; keep metadata-store encryption a recommended near-term default.
