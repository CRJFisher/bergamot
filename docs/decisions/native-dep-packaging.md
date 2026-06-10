# Decision: native and runtime dependency packaging for the VS Code extension

## Decision

The packaged extension ships as an esbuild-bundled artifact plus exactly the unbundleable runtime dependencies, packaged from a clean staging directory. The headless re-download browser is never inside the VSIX: it is provisioned once, on first use, into an app-owned directory.

## The problem this solves

Two facts make naive `vsce package` produce a broken extension:

1. **npm workspaces hoist dependencies to the repository root.** `vsce` packages from `vscode/`, so root-hoisted production dependencies (`patchright`, `express`, …) are invisible to it — `require("patchright")` cannot resolve on an installed extension.
2. **Native and asset-bearing packages cannot be inlined.** `@duckdb/node-api` loads a platform-specific `.node` binding (~113 MB `libduckdb`), and `patchright` carries browser registry descriptors and dynamic requires.

## The mechanism

- **Bundle** (`vscode/scripts/bundle.mjs`): esbuild bundles the three runtime entrypoints — `out/extension.js`, `out/mcp_server_standalone.js`, `out/server/server_standalone.js` — into self-contained CJS files, inlining every pure-JS dependency. Exactly three modules stay external: `vscode` (extension-host-provided), `@duckdb/node-api`, and `patchright`. `tsc` still runs first: it is the type-checker and produces the unbundled layout that jest and the e2e harness use.
- **Stage** (`vscode/scripts/build-production.js` → `stage_package_dir`): a clean `builds/staging/` directory receives the bundled `out/`, a manifest whose `dependencies` are trimmed to the two shipped externals, and a `node_modules` containing those externals plus their full transitive dependency closure (resolved from wherever npm physically placed them; optional per-platform packages are staged only when present). Packaging from the dev directory is non-deterministic — `vsce` ships whatever physically sits in `node_modules`, which in a workspace is an accident of hoisting.
- **Package**: `vsce package` runs in the staging directory. The VSIX is **platform-specific by construction** — the staged `@duckdb` binding is the build host's. Published builds use `vsce package --target <platform>` per supported platform.

## The browser is provisioned, not packaged

Chromium (~250 MB download, ~570 MB on disk with the headless shell) would dwarf any marketplace limit and churn on every patchright bump. Instead (`vscode/src/redownload/browser_provisioner.ts`):

- `PLAYWRIGHT_BROWSERS_PATH` is pinned to `~/.bergamot/ms-playwright` (a pre-set environment variable is respected) **before patchright first loads** — the browser pool imports patchright lazily for exactly this reason, since patchright's registry reads the variable at module load.
- The first content fetch that finds no Chromium starts a single-flight `patchright install chromium` and fails fast; the content read path serves its normal 503 "unavailable" until the install completes, and the extension surfaces a one-time progress notification. Activation is never blocked.
- The download is cached across sessions and extension updates (the directory is owned by Bergamot, not the extension version), and is architecture-correct for the host because patchright resolves the build itself.
- The download is a named first-run egress to Playwright's CDN (see `docs/threat-model.md`, adversary C).

## Verification

The packaged artifact is verified by unzipping the VSIX into a clean directory (no workspace `node_modules`), starting the bundled headless server from it with an empty browsers directory, and driving a visit through `/visit` → `/query/capture_content`: the first read reports the provisioning 503, and after the one-time install the read returns the live page content.
