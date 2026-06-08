---
id: TASK-39.2
title: "Re-download / post-processing content fetcher + content read path (keystone)"
status: To Do
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

- [ ] #1 The fetcher re-downloads the page for a stored metadata row's URL and returns its content
- [ ] #2 Outcomes are classified; authenticated/paywalled/redirect/dead pages are excluded (no content) and public pages succeed — verified by tests over representative URLs/fixtures
- [ ] #3 `<meta>`-derived fields (author, published-at, lang, site name) are parsed from the re-downloaded page
- [ ] #4 Each fetch records fidelity metadata: `fetched_at`, `http_status`, and a content hash
- [ ] #5 `get_webpage_content` and `/query/capture_content` serve re-downloaded content and report unavailable for excluded pages
- [ ] #6 Re-download is rate-limited with backoff/retry (polite egress)
- [ ] #7 The fetcher exposes a documented corpus interface that TDT/RAG consume (the re-downloadable public subset)
<!-- AC:END -->
