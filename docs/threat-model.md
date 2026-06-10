# Threat Model

The written threat model the constitution names as the prerequisite for the at-rest-encryption, authentication, re-download, and metadata-sync decisions (Operating Principles → Capture and storage). It states who the adversary is, what is being protected, which defenses exist, and — honestly — what those defenses do not cover.

## Setting

Bergamot serves a **single trusted user** on a **possibly-shared or possibly-compromised machine**, with **hostile local processes in scope**. There is no multi-user tenancy, no developer-controlled server, and no cloud component in the trust boundary: everything of value lives on the user's machine (constitution principle 1).

## Assets

1. **The metadata store** — the DuckDB file (`webpage_categorizations.db`): visit ids, URLs, titles, timestamps, and the navigation/session graph. This is the durable source of truth. URLs are themselves sensitive metadata: query strings, tokens, identifiers, and the bare fact of a visit can each leak information (principle 3, residual surface).
2. **The data-encryption keys** — one per encrypted store (metadata store; content cache), each persisted by VS Code `SecretStorage` encrypted under a wrapping key held in the OS keystore (macOS Keychain / libsecret / DPAPI).
3. **The visit inbox** (`<storage_base>/visit_inbox/`) — per-visit JSON files (URL, referrer, timestamps) buffered between HTTP accept and the DuckDB write.
4. **The re-downloaded content cache** (`content_cache.db`) — on-demand, encrypted, quarantined page content fetched from stored public URLs; populated only when a consumer opts in with a named scope (TDT, task-36.3, when it lands). The right-to-forget cascade (`Bergamot: Forget`) opens the cache only to delete from it.
5. **Derived stores** (task-36/31, not yet built) — embedding vectors and cluster tables built from re-downloaded content; they encode content and are bound to the right-to-forget cascade (principle 4).
6. **The user's PKM repo** — user-authored notes; holds only explicitly-promoted artifacts, never captured data (principle 6).

## Adversaries and what defends against them

### A. Offline / file-level access to the machine

Stolen or discarded disk, machine backups, a shared machine's other (non-root) accounts, file-grabbing malware that exfiltrates files without code execution in the user's session, cloud-synced directories that accidentally include storage paths.

**Defense: at-rest encryption.** The metadata store is DuckDB-native encrypted (AES, DuckDB ≥ 1.4) and is **only ever created encrypted** — the data layer refuses to open or create a plaintext file store; the database file, its WAL, and its temp spill files (`temp_file_encryption`, pinned to the store's own `.tmp` directory) are all ciphertext. Without the key they disclose their size, existence, and that they are DuckDB files — nothing of their contents. The content cache tier carries the same property, as its own encrypted DuckDB store under its own keystore key — destroying the cache key forfeits only the cache: delete the orphaned file and consumers repopulate it by re-downloading.

One honest bound on deletion inside an encrypted store: a deleted row's ciphertext can persist in freed blocks inside the file until DuckDB reuses them. It is unreadable without the live key; emptying a store truncates the file (real deletion), and the forget cascade (`right_to_forget.ts`) documents this residue as its bound.

**Plaintext side-channels, named honestly.** Three paths put metadata on disk unencrypted and are open gaps against this adversary, not covered by store encryption: the **visit inbox** holds each visit as a plaintext JSON file between HTTP accept and the DuckDB write (deleted after ingest, forensically recoverable, persistent if ingest fails); the **dev replay ring** (`<storage_base>/captures/`) keeps a bounded ring of plaintext visit JSONs while dev logging is on; and **dev-mode logging** writes visit URLs to `dev-log.jsonl`. The right-to-forget cascade sweeps matching inbox and replay files, but a file present before a forget is forensically recoverable after deletion, and `dev-log.jsonl` is never rewritten. Closing the inbox encryption gap is tracked follow-up work under task-39.

**Key handling.** Each store's data-encryption key is 32 random bytes generated on first run, held via `SecretStorage`, never logged, and never leaves the machine. `SecretStorage` persists the key encrypted under a wrapping key in the OS keystore — on macOS and Windows that wrapping key is keystore-protected; on Linux without a functioning keyring, Electron's `safeStorage` degrades to a hardcoded-key scheme and the at-rest defense weakens to obfuscation against offline file access. A fresh key is minted only when no store file exists; if the store exists and the keystore returns nothing, activation fails loudly rather than silently re-keying (a transient keystore failure must not destroy the only copy of the real key). There is **no key escrow, no recovery path, and no plaintext fallback: losing a key is losing its store.** That is accepted data loss — the metadata record rebuilds only by future browsing; the content cache costs only re-downloads.

One exception to keystore sourcing: the headless E2E server has no `SecretStorage`, so the harness that spawns it supplies a per-run random key via the `STORAGE_ENCRYPTION_KEY` environment variable; the store it encrypts is itself per-run and discarded, and the extension's own store can never be opened that way (its key is not exportable).

### B. A hostile process running as the user, while the session is unlocked

Malware executing in the user's account during normal use.

**Honest statement: at-rest encryption does not defend against this adversary.** A process running as the user can read the OS keystore entry the same way the extension does, attach to the running extension host, or simply query the live local server. At-rest encryption narrows the damage of *some* malware (the file-grabbing kind in A); it is not a sandbox.

What does bound this adversary, partially:

- **Local-server authentication** (principle 7, Scope-Now, not yet implemented): a per-extension capability token on `/visit`, every `/query`, and any re-download/sync endpoint, with loopback binding as a second layer. Until the token ships, any local process can read the query API of a running extension — this is the largest open gap in the current posture.
- **OS keystore ACLs**: on macOS, Keychain access prompts on first read by a new binary; this is friction, not a guarantee.

### C. Network observers of re-download traffic

Re-download is the system's one routine egress surface: it re-fetches stored URLs from the user's machine, so an on-path observer (or the destination sites) sees which public URLs this machine fetches.

**Defenses and bounds:** fetches go only to URLs the user already visited; they carry **no cookies and no credentials** (the login wall is the privacy filter — principle 3); rate-limiting, backoff, and retry discipline bound the traffic (re-download is polite egress). Capture metadata itself never leaves the machine.

One additional first-run egress: the headless browser is provisioned by a one-time download of Chromium from Playwright's CDN into `~/.bergamot/ms-playwright` (a packaged install ships no browser). The CDN — and any on-path observer — learns the machine's IP address and that a Playwright-compatible Chromium was installed at that moment: nothing about browsing, and indistinguishable from any other Playwright-based tool. The download never recurs once cached, and the directory holds only the browser binary, no user data.

### D. Developer-controlled or third-party servers

**Defense: architecture.** There is no telemetry, no cloud store, and no developer server in any data path. Metadata sync, when built (task-37), travels only over user-owned channels; its additional surface (device authentication, channel trust, conflict handling) is assessed when that channel is designed, per the constitution's deferred-decision list.

### E. Other people using the same browser profile or editor

**Defense: capture visibility and refusal.** Private-browsing windows are never captured (`"incognito": "not_allowed"`, principle 2). The capture indicator and one-click pause (principle 5, Scope-Now, not yet implemented) will make recording visible and stoppable; today the only visible surface is a capture-failure badge. Someone with the user's unlocked session is indistinguishable from the user — that is outside the model, consistent with B.

## Non-goals

- Defending the unlocked session against an attacker already executing as the user (B is bounded, not solved).
- Forensic deniability: file sizes, timestamps, and the existence of the stores remain visible.
- Multi-user isolation on one OS account.
- Availability: ransomware or deletion of the store is data loss; the durable record is rebuilt by browsing, not from backups Bergamot manages.

## Standing decisions this model underwrites

- **At-rest encryption of the metadata store** (task-39.4): defends A; explicitly does not defend B.
- **Encrypted, quarantined content cache** (task-39.3): same key-handling discipline, separate key; quarantine additionally closes silent egress via git-tracked/pushable directories (principle 6).
- **Capability-token authentication on the local server** (Scope-Now): the named mitigation for B's live-API exposure.
- **Cascading right-to-forget** (task-39.5): `right_to_forget.ts` deletes by URL, origin, or time range across the metadata record (including the fetch log by stored and post-redirect URL, referrer scrubbing on surviving visits, and empty-tree removal), the encrypted content cache, the plaintext visit-inbox and replay buffers, and the in-memory outcome ring; the live queue is purged first. Vector and cluster stores join the cascade as they land. Deletes are transactional per store and idempotent across stores, derived-content-first; cross-store atomicity over separate database files is not possible — a failure between stores can only leave metadata without content (the safe direction), and re-running the forget completes it. What survives a forget: `dev-log.jsonl` lines, and the forensic recoverability of any plaintext buffer file that existed before the forget.
