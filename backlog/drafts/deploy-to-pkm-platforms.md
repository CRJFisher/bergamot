# Deploy Bergamot to PKM Platforms — Plan

Canonical plan for expanding Bergamot beyond its current VS Code host to other PKM platforms. Defines the goal, the runtime constraint that decides which platforms are reachable, the sidecar-extraction work that unlocks the rest, and the ordered deployment waves with concrete tasks. Derived from a 26-platform feasibility study against the 24 host requirements extracted from the live `vscode/` extension.

## Goal

Ship Bergamot to as many PKM platforms as the privacy model allows, fastest-first. A "deployment" means the user installs Bergamot into their PKM of choice and gets the spine: metadata-only capture → encrypted local store → re-download → MCP query → note-stub write-back. Where the full spine is impossible, the fallback deliverable is **PKM write-back only** — Bergamot runs its backend elsewhere and pushes editable note stubs into that PKM.

Every wave below advances the UNDERSTAND/SURFACE spine node (the hero loop reaching more users' PKMs) and is justified as the cheapest change that does so.

## The constraint that shapes the plan

Bergamot's feature set forces five hard requirements on any host. A platform that satisfies all five can host the full spine in-process; a platform that fails any of them needs the sidecar (below) or is write-back-only.

1. **Native N-API addon loading** — `@duckdb/node-api` loads a prebuilt `.node` binary. Fails in browser sandboxes and non-JS runtimes; under Electron the ABI may not match stock-Node prebuilts (`electron-rebuild` territory).
2. **Long-lived child-process spawning** — the headless Chromium re-download (Playwright/patchright) and the MCP stdio server are both spawned via `child_process.spawn`. Fails in sandboxed renderers.
3. **Local TCP listening socket** — the Express server on `127.0.0.1:5000-5009` that the browser extension POSTs visits to. Fails in browser-only and cloud hosts.
4. **OS keychain-backed secret storage** — the encryption DEKs live in the OS keystore via `vscode.SecretStorage`, with no plaintext fallback. Platforms lacking an equivalent weaken at-rest encryption to obfuscation.
5. **`vscode.ExtensionContext` lifecycle** — `extension.ts` consumes `globalStorageUri`, `extensionPath`, `secrets`, `subscriptions` with no shims. Any non-VS-Code host needs the activation layer rewritten.

Two of these are also constitutional, not merely technical: any platform whose data path runs through a developer-controlled cloud (Notion, Reflect, Capacities, Tana, Roam's settings store) violates principle 1 (local-only) and is out of scope regardless of its plugin model.

## The enabling decision: extract a sidecar core

The single highest-leverage piece of work — it unlocks every non-VS-Code platform — is to extract the Bergamot backend (DuckDB stores, Express server, Playwright re-download, MCP server) into a **standalone long-lived Node.js daemon**, with each PKM getting a **thin plugin** that acts as its client. The daemon is already ~80% present: it is today's extension backend minus the VS Code UI wiring.

What the sidecar fixes: cruxes 1–3 move into the daemon, where they are unconditionally satisfiable (a bare Node process can load native addons, spawn children, and bind a socket).

What the sidecar does **not** fix, and must be solved per-host:

- **Crux 4 (keystore).** The daemon still has to put the DEKs somewhere. A bare-Node daemon needs `keytar` (archived, native-build burden), an OS-CLI shim (`security` / `cmdkey` / `secret-tool` — workable, fragile), or an Electron shell. None are drop-in.
- **Crux 5 (lifecycle).** Each thin plugin must spawn the daemon on load, write `port.json`, and kill it on unload, against that platform's own plugin API. Mechanical (1–3 wks/platform) but multiplies with targets.

The sidecar preserves every privacy invariant: all metadata, all encrypted stores, all derived content stay local; it is a local process under the user's account. It does **not** rescue cloud-routed platforms — write-back through a developer cloud still violates principle 1.

---

## Execution waves (ordered)

### Wave 0 — Gating experiments (decide before committing effort)

These are cheap and they gate the cost of everything downstream. Run them first.

- [ ] **DuckDB-under-Electron ABI test (~1 day).** Load `@duckdb/node-api` inside a VS Code extension against current VS Code (Electron 42 / Node 24.15) and confirm `ATTACH ... (ENCRYPTION_KEY '...')` executes. Decides whether Waves 1–3 ship prebuilt `.node` binaries directly or need `electron-rebuild` / per-ABI builds. (ChuckJonas's DuckDB VS Code extension is evidence the load path works; DuckDB ≥1.4 encryption is the unverified part.)
- [ ] **SiYuan `@electron/remote` safeStorage probe (~15 min).** `require('@electron/remote').safeStorage?.encryptString('test')` from a SiYuan plugin. If it works, SiYuan's keystore gap closes and an in-process port becomes viable instead of forcing the sidecar.
- [ ] **Joplin DuckDB-load PoC (~2–3 days).** Bypass `joplin.require()` via webpack `externals`, load the DuckDB `.node` from an absolute path, run an encrypted in-memory `ATTACH`. Decides whether Joplin is a 3–5 mo in-process port or drops to sidecar-write-back.

### Wave 1 — VS Code-native PKMs (ship now, ~1–2 wks total)

Both are VS Code extensions, so Bergamot already satisfies all five cruxes. Deployment is packaging + a write-back target. Gated only on Wave-0 DuckDB test.

- [ ] Build a platform-specific VSIX matrix (one per OS/arch) bundling the matching prebuilt DuckDB `.node` binary.
- [ ] Implement generic **"configured markdown directory" write-back**: discover the active workspace, write agent-authored note stubs into a quarantined `bergamot.staging/` subdir (constitution principle 8 — never write into canonical user notes). Pure filesystem, no PKM API coupling.
- [ ] **Foam** — read Foam workspace config for the stub target; Foam's file watcher surfaces stubs automatically.
- [ ] **Dendron** — read `dendron.yml` for the vault path. Note: Dendron is unmaintained (last release Aug 2023) — keep the integration generic (the "configured markdown directory" feature) so it survives users migrating away.

### Wave 2 — Obsidian desktop (~4–8 wks)

Largest PKM user base; Electron desktop with `nodeIntegration:true`, confirmed TCP-server-capable plugins, and `app.secretStorage` (≥1.11.4, `safeStorage`-backed since 1.12.x). Gated on the Wave-0 ABI test against Obsidian's Electron 39 specifically.

- [ ] Rewrite the plugin host layer against Obsidian's `Plugin` class API (2–3 wks): `context.globalStorageUri` → `os.homedir()/.bergamot/`, `context.extensionPath` → plugin dir, `context.subscriptions` → `this.register()`.
- [ ] Map DEK storage onto `app.secretStorage` (~1 wk) — namespaced `METADATA_DB_KEY_SECRET` / `CONTENT_CACHE_KEY_SECRET`.
- [ ] Solve native-binary distribution: the community store forbids native blobs, so download the per-OS DuckDB `.node` on first activation (or ship outside the store).
- [ ] **Fallback if the ABI test fails:** ship the sidecar daemon + an Obsidian plugin that is a thin HTTP client (~2–3 wks, Node is then the unambiguous host).

### Wave 3 — SiYuan desktop (~5–10 wks, sidecar recommended)

Technically the most capable non-VS-Code host: `nodeIntegration:true`, `webSecurity:false`, confirmed `require('http')`/`child_process` in community plugins (`syplugin-anMCPServer`), and a native `siyuan.mcp.registerTool()` API. The keystore gap (Electron `safeStorage` is main-process-only, no IPC bridge) makes the sidecar the cleaner path unless the Wave-0 probe passes.

- [ ] Spawn a standalone Node daemon from the plugin via `child_process.spawn` using the **system `node`** (sidesteps the Electron ABI problem entirely).
- [ ] SiYuan plugin becomes a coordinator: spawn daemon, register MCP tools that proxy to it, write note stubs via the Kernel API.
- [ ] Keystore: PR a safeStorage IPC bridge to SiYuan core, or use the OS-CLI key shim in the daemon.

### Wave 4 — Sidecar write-back tier (per-target, 2–6 wks each)

For platforms where the full spine can't run in-process but a local (non-cloud) write-back is honest. Build once the daemon exists (Wave 2/3 fallback path produces it). Each delivers the SOFT `pkm-write-back` capability only.

- [ ] **Logseq** — thin plugin → `localhost:12315` (the established `mcp-logseq` integration pattern). Full spine is blocked by the sandboxed iframe; write-back only.
- [ ] **TiddlyWiki (Node server edition)** — thin TW plugin as REST client to the daemon; TW `route` module-type for query display. (Single-file `.html` mode is incompatible — Node server mode only.)
- [ ] **Emacs Org-roam / Org-mode** — `bergamot.el` thin client: `make-network-process` to the daemon, `auth-source` for keys (macOS/Linux; Windows is second-class), `.org` stub write-back.
- [ ] **Anytype** — local REST API write-back (no cloud relay — constitutionally clean).
- [ ] **Memos** — self-hosted local REST write-back.

### Joplin — pending Wave-0 PoC

If the Joplin DuckDB PoC passes: a 3–5 mo in-process port, with the **Linux keystore regression** (`shim.ts` disables the keychain on Linux → keys fall back to plaintext SQLite) as an outstanding decision — must be surfaced to users, not silently accepted (constitution). If the PoC fails: drops to Wave 4 sidecar-write-back (~6–8 wks).

---

## Out of scope

**Blocked — no path to the full spine, and write-back is also barred or low-value:**

- _Cloud data path violates principle 1 (local-only):_ Notion, Reflect, Capacities, Tana, Roam Research, Heptabase. Not targeted at any tier.
- _No plugin runtime / browser-only sandbox / no published SDK:_ AFFiNE, AppFlowy, RemNote, Bangle.io, Standard Notes, Notesnook, Zettlr.
- _Abandoned:_ Athens Research (dead since Dec 2022, Node 14 < floor).
- _Trilium_ — ETAPI write-back is technically possible but only worth wiring if a daemon already exists for another target; not a primary platform.

## Follow-up research candidates (not yet assessed)

Quarto (a VS Code extension — would inherit Bergamot's host for free; likely a 5th "ready" candidate, assess next), Craft, Bear, Nextcloud Notes, Hypothesis, nb (CLI plain-files — trivial sidecar write-back), Zed (Rust/WASM, no Node), Neovim (Lua, no Node — same shape as Emacs). GitBook / Coda / Mem.ai are cloud-only and would be blocked.
