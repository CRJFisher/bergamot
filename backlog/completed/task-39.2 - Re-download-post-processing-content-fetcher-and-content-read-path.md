---
id: TASK-39.2
title: "Re-download / post-processing content fetcher + content read path (keystone)"
status: Done
assignee: []
created_date: "2026-06-08 13:30"
labels:
  - capture
  - fetcher
  - privacy
dependencies: []
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - backlog/drafts/privacy-reorientation-plan.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Build the keystone of the privacy-core model: a post-processing fetcher that obtains page content by RE-DOWNLOADING the stored public URL (server/desktop-side), and repoint the content read path at it. Every content consumer (TDT, RAG-prep, image extraction) depends on this.

MECHANISM: read metadata rows that lack content, fetch the URL, and classify the outcome: ok / auth-redirect / 403 / paywall / dead-link. **Authenticated and paywalled pages fail and are excluded — the login wall is the privacy filter** (no "is this sensitive?" heuristic). Public/informational pages succeed.

OUTPUTS: parse the `<meta>`-derived fields (author, published-at, lang, site name) from the fetched page; emit fidelity metadata per fetch (`fetched_at`, `http_status`, content hash) so unavailability and drift are visible. Re-download is polite egress: rate-limited, with backoff/retry.

READ PATH: repoint `get_webpage_content` (`vscode/src/mcp_server_standalone.ts`) and `/query/capture_content` (`vscode/src/server/server_manager.ts`) to serve re-downloaded (optionally cached, see 39.3) content; for excluded pages they report unavailable by design.

CONTRACT: the fetcher output is the **re-downloadable public corpus** consumed by TDT first, then RAG. Auth-walled / failed visits are trail/metadata only and are absent from this corpus.

SEQUENCING: lands with or before task-39.1's removal of the stored-content read path, so content reads are never silently broken. Caveat to document: a re-downloaded page is not guaranteed to equal the as-viewed page (dynamic content, dead links, drift).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 The fetcher re-downloads the page for a stored metadata row's URL and returns its content
- [x] #2 Outcomes are classified; authenticated/paywalled/redirect/dead pages are excluded (no content) and public pages succeed — verified by tests over representative URLs/fixtures
- [x] #3 `<meta>`-derived fields (author, published-at, lang, site name) are parsed from the re-downloaded page
- [x] #4 Each fetch records fidelity metadata: `fetched_at`, `http_status`, and a content hash
- [x] #5 `get_webpage_content` and `/query/capture_content` serve re-downloaded content and report unavailable for excluded pages
- [x] #6 Re-download is rate-limited with backoff/retry (polite egress)
- [x] #7 The fetcher exposes a documented corpus interface that TDT/RAG consume (the re-downloadable public subset)
<!-- AC:END -->

## Implementation Notes

## High-level summary

Bergamot's privacy-core model captures only browsing metadata and obtains page content later by re-downloading the public URL. This task builds that re-download path — the keystone every content consumer (Temporal Topic Detection, RAG, image extraction) depends on.

A stealth headless browser (patchright) re-downloads each stored URL as an anonymous visitor — no cookies, no profile — and a pure classifier turns what the browser saw into an outcome. The login wall is the privacy filter: because the browser carries no credentials, authenticated and paywalled pages fail to render content and are excluded automatically, with no topic-sensitivity heuristic. The one notable decision is stealth (anti-bot evasion): it widens coverage of genuinely public pages that block headless browsers, without ever touching the auth boundary — the anonymous context keeps the login wall doing the filtering.

The work lands as a new `redownload/` package plus a repointed read path. The package holds a pure outcome classifier, a patchright browser pool, a per-host politeness gate (rate-limit + backoff/retry), the headless fetcher, and a corpus that binds them to the store. The content read path — `/query/capture_content` and the `get_webpage_content` MCP tool — now serves re-downloaded content and reports unavailable for excluded pages; the old stored-content read (`read_capture`) and its dead byte-reader are deleted. A new append-only `webpage_fetch` log records each fetch's outcome, fidelity (`fetched_at`, `http_status`, content hash), and parsed `<meta>` so unavailability and drift stay visible.

To navigate: start at `redownload/corpus.ts` — the front door and the contract TDT/RAG consume (`get_content`, `iter_public_pages`). `fetch_outcome.ts` is the pure classifier where the privacy filter lives; `headless_fetcher.ts` + `browser_pool.ts` hold all Chromium coupling; `politeness_gate.ts` is the egress discipline. The read path enters at `server_manager.ts`.

What to watch: each read is a **live, side-effecting re-download** — there is no content cache in this tier (task-39.3 adds the encrypted on-demand cache). Login/paywall detection is regex over the rendered HTML, so a JS-mounted SPA wall that appears after the settle window is a known fidelity limit. Chromium provisioning for a packaged extension (the ~150 MB browser is downloaded out-of-band) is **not yet wired** — a follow-up before release; until then a launch failure degrades to a 503 "unavailable". The `content_compressed` BLOB column is still written by the capture pipeline and unread; task-39.1 drops it.

### Implementation details

- **`redownload/fetch_outcome.ts`** — the pure, browser-free classifier. `classify_fetch(observation)` returns a discriminated `FetchOutcome` (`ok` / `auth_redirect` / `forbidden` / `paywall` / `dead_link` / `non_html`); only `ok` enters the corpus. Login detection keys off final URL / redirect chain / a rendered password form; paywall off schema.org `isAccessibleForFree:false` and known containers. `extract_markers_from_html` is the single marker extractor (regex over serialized rendered HTML), reused by the fetcher and the tests. (AC#2)
- **`redownload/headless_fetcher.ts` + `browser_pool.ts`** — patchright Chromium, launched lazily and shared, one ephemeral cookie-free context, a fresh page per fetch. `observe()` captures the final main-frame response (so a download-aborted PDF classifies as `non_html`), reuses `read_metadata` on the rendered HTML (AC#3), and computes the sha-256 content hash (AC#4). A fetch never throws on a page-level failure — failures come back as exclusion outcomes. (AC#1–#4)
- **`redownload/politeness_gate.ts`** — a generic async scheduler: per-host minimum interval, global + per-host concurrency caps, exponential backoff with jitter, and `Retry-After` honouring. Only transient failures (timeout / 5xx / 429) retry. (AC#6)
- **`redownload/corpus.ts`** — `ContentCorpus` (`get_content`, `iter_public_pages`), the documented contract TDT/RAG consume; `get_content` re-downloads on demand and appends the fidelity record; `iter_public_pages` yields only the `ok` subset with per-page error isolation. (AC#7)
- **Persistence** — new `webpage_fetch` table + `insert_webpage_fetch` / `get_latest_webpage_fetch` in `duck_db.ts`; `WebpageFetchSchema` in `page_capture_models.ts`. No page-content column (deferred to 39.3). (AC#3/#4)
- **Read path** — `/query/capture_content` (server_manager.ts) and the `get_webpage_content` MCP tool serve the discriminated corpus entry and report unavailable for exclusions; a re-download infrastructure failure degrades to a 503. `read_capture` and `get_webpage_capture_bytes` are deleted. (AC#5)
- **Tests** — classifier and politeness-gate unit tests; a real-browser integration test over a loopback fixture server covering every outcome branch; a corpus test (fake fetcher + real DuckDB) for persistence and the public-subset iteration; a read-path test for ok / unavailable / 503; browser-pool lifecycle tests. Obsolete lossless-store tests rewritten to the metadata-only / re-download contract.

### Status

Done.
