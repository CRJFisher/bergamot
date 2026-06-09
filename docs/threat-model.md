# Threat Model

The written threat model the constitution names as the prerequisite for the at-rest-encryption, authentication, re-download, and metadata-sync decisions (Operating Principles → Capture and storage). It states who the adversary is, what is being protected, which defenses exist, and — honestly — what those defenses do not cover.

## Setting

Bergamot serves a **single trusted user** on a **possibly-shared or possibly-compromised machine**, with **hostile local processes in scope**. There is no multi-user tenancy, no developer-controlled server, and no cloud component in the trust boundary: everything of value lives on the user's machine (constitution principle 1).

## Assets

1. **The metadata store** — the DuckDB file (`webpage_categorizations.db`): visit ids, URLs, titles, timestamps, and the navigation/session graph. This is the durable source of truth. URLs are themselves sensitive metadata: query strings, tokens, identifiers, and the bare fact of a visit can each leak information (principle 3, residual surface).
2. **The data-encryption key** for the metadata store, held in the OS keystore (macOS Keychain / libsecret / DPAPI) via VS Code `SecretStorage`.
3. **The re-downloaded content cache** (task-39.3) — on-demand, encrypted, quarantined page content fetched from stored public URLs.
4. **Derived stores** — embedding vectors and cluster tables built from re-downloaded content; they encode content and are bound to the right-to-forget cascade (principle 4).
5. **The user's PKM repo** — user-authored notes; holds only explicitly-promoted artifacts, never captured data (principle 6).

## Adversaries and what defends against them

### A. Offline / file-level access to the machine

Stolen or discarded disk, machine backups, a shared machine's other (non-root) accounts, file-grabbing malware that exfiltrates files without code execution in the user's session, cloud-synced directories that accidentally include storage paths.

**Defense: at-rest encryption.** The metadata store is DuckDB-native encrypted (AES, DuckDB ≥ 1.4) and is **only ever created encrypted** — the data layer refuses to open or create a plaintext file store, so no plaintext copy of the metadata ever exists on disk. The content cache tier carries the same property (task-39.3). The on-disk files are ciphertext; without the key they disclose nothing but their size and existence.

**Key handling.** The data-encryption key is 32 random bytes generated on first run and stored only in the OS keystore via `SecretStorage`. It is never written to a file, never logged, and never leaves the machine. There is **no key escrow, no recovery path, and no plaintext fallback: losing the key is losing the store.** That is accepted data loss — the record rebuilds only by future browsing.

### B. A hostile process running as the user, while the session is unlocked

Malware executing in the user's account during normal use.

**Honest statement: at-rest encryption does not defend against this adversary.** A process running as the user can read the OS keystore entry the same way the extension does, attach to the running extension host, or simply query the live local server. At-rest encryption narrows the damage of *some* malware (the file-grabbing kind in A); it is not a sandbox.

What does bound this adversary, partially:

- **Local-server authentication** (principle 7, Scope-Now, not yet implemented): a per-extension capability token on `/visit`, every `/query`, and any re-download/sync endpoint, with loopback binding as a second layer. Until the token ships, any local process can read the query API of a running extension — this is the largest open gap in the current posture.
- **OS keystore ACLs**: on macOS, Keychain access prompts on first read by a new binary; this is friction, not a guarantee.

### C. Network observers of re-download traffic

Re-download is the system's one routine egress surface: it re-fetches stored URLs from the user's machine, so an on-path observer (or the destination sites) sees which public URLs this machine fetches.

**Defenses and bounds:** fetches go only to URLs the user already visited; they carry **no cookies and no credentials** (the login wall is the privacy filter — principle 3); rate-limiting, backoff, and retry discipline bound the traffic (re-download is polite egress). Capture metadata itself never leaves the machine.

### D. Developer-controlled or third-party servers

**Defense: architecture.** There is no telemetry, no cloud store, and no developer server in any data path. Metadata sync, when built (task-37), travels only over user-owned channels; its additional surface (device authentication, channel trust, conflict handling) is assessed when that channel is designed, per the constitution's deferred-decision list.

### E. Other people using the same browser profile or editor

**Defense: capture visibility and refusal.** Private-browsing windows are never captured (`"incognito": "not_allowed"`, principle 2); the capture indicator and one-click pause (principle 5) make recording visible and stoppable. Someone with the user's unlocked session is indistinguishable from the user — that is outside the model, consistent with B.

## Non-goals

- Defending the unlocked session against an attacker already executing as the user (B is bounded, not solved).
- Forensic deniability: file sizes, timestamps, and the existence of the stores remain visible.
- Multi-user isolation on one OS account.
- Availability: ransomware or deletion of the store is data loss; the durable record is rebuilt by browsing, not from backups Bergamot manages.

## Standing decisions this model underwrites

- **At-rest encryption of the metadata store** (task-39.4): defends A; explicitly does not defend B.
- **Encrypted, quarantined content cache** (task-39.3): same key-handling discipline; quarantine additionally closes silent egress via git-tracked/pushable directories (principle 6).
- **Capability-token authentication on the local server** (Scope-Now): the named mitigation for B's live-API exposure.
- **Cascading right-to-forget** (task-39.5): bounds the blast radius of every asset by making deletion real across metadata, cache, vectors, and clusters.
