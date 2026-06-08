# Privacy-Preserving Capture Model

Canonical, product-wide reference for what bergamot captures, where it is stored, and how it is protected. Privacy is the core organizing principle; this model governs desktop and mobile capture alike and constrains every downstream consumer (TDT, RAG, sync). The authoritative version of these commitments lives in [docs/constitution.md](../../docs/constitution.md); this draft is the working architectural description.

## Principle

Bergamot captures **browsing metadata only — never page content**. It records the trail (URL, title, timestamp, navigation/session graph), stores that metadata locally as the durable source of truth, and obtains page content only later by **re-downloading public pages from their stored URLs**. The login wall is the privacy filter: pages behind authentication fail to re-download and are excluded automatically.

Browsing metadata is still personal data (URLs leak search terms, document ids, tokens, identities), so it is handled as such: opt-in, transparent, local-only, deletable, and encryptable at rest.

## Capture — metadata only

Captured for every non-incognito visit:

- visit id, URL, page-load timestamp, page title — taken directly from the tab (no page body needed)
- the session graph: referrer chains, tab-opener relationships, group/session ids, and SPA pushState/replaceState navigation events

Page content (HTML/text) is never captured or stored at browse time. The capture gate keeps the visit after incognito refusal; it does not inspect content (there is none) and does not run any sensitivity heuristic.

## Content — re-download during post-processing

Page content is acquired later, server-side or on the desktop, by re-downloading the stored URL:

- **The login wall is the filter.** Authenticated and paywalled pages return a login redirect / 403 / paywall and are excluded. Public, informational pages re-download successfully and are safe to process. No "is this sensitive?" detection is needed or trusted.
- The fetcher classifies each outcome (ok / auth-redirect / 403 / paywall / dead link) and emits fidelity metadata (`fetched_at`, `http_status`, content hash) so unavailability and drift are visible.
- Re-download is polite egress: rate-limited, backed off, retried within discipline.

`<meta>`-derived fields (author, published-at, lang, site name) are parsed from the re-downloaded page, not at capture. Title/URL/timestamp are already captured directly.

## Storage safety

- The **metadata store** is the durable source of truth, encrypted at rest with an OS-keystore-backed key (e.g. VS Code `SecretStorage`; DuckDB native encryption).
- Any **re-downloaded content that is cached** is a separate tier: encrypted at rest, scoped (e.g. to a research project), and deletable. No plaintext page content on disk.
- Right-to-forget is cascading: deleting by URL / origin / time-range atomically removes the metadata row, any content cache, derived vectors, and cluster memberships.

## Downstream — TDT first, then RAG

- The clusterable/searchable corpus is the **re-downloadable public subset**. Visits whose pages fail to re-download (auth-walled, dead) remain as trail/metadata only and are **excluded from clustering and retrieval** — a deliberate coverage choice.
- Temporal Topic Detection runs first over the re-downloaded public content (embed → cluster). RAG-based research tools come after.

## Sync scope

Metadata syncs over **user-owned channels only** (device-to-device P2P / a synced inbox folder / the user's own iCloud) — never a developer-controlled server. Any cached content syncs only if the user enabled it, encrypted. This keeps the mobile App Privacy posture minimal (potentially "Data Not Collected" when sync is device-to-device).

## Consent & transparency

- Capture is opt-in, off until enabled; private/incognito sessions are never captured.
- An always-on capture indicator and a one-click pause/kill ship with the recorder.
- A privacy policy and accurate App Privacy labels describe what is captured and where it goes; the UI offers pause, per-site exclude, view, and delete.

## Known trade-off — re-download fidelity

A re-downloaded page is not guaranteed to equal the page as viewed: dynamic/JS-rendered content, dead links, paywall/consent drift, A/B variants, and edits over time all diverge. Citations reference the URL and metadata, not a byte-for-byte snapshot. Drift is surfaced via `fetched_at` + content hash + status.

## Bottom line

Capture the trail, never the contents. Re-download public pages to understand them and let the login wall exclude the private ones. Keep the metadata store encrypted and local, content caches encrypted and on-demand, and sync only over the user's own devices. This is the organizing principle for desktop and mobile — and what makes the mobile product defensible at store review.
