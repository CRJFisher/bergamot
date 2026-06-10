#!/usr/bin/env node

/**
 * Bundles the extension's runtime entrypoints into self-contained CJS files
 * for packaging. This is the JS half of the native-dep packaging strategy
 * (docs/decisions/native-dep-packaging.md): every pure-JS dependency —
 * including the ones npm hoists to the workspace root, which vsce can never
 * see — is inlined; only three modules stay external:
 *
 *  - vscode               (provided by the extension host)
 *  - @duckdb/node-api     (native .node binding — cannot be inlined)
 *  - patchright           (browser asset descriptors + dynamic requires)
 *
 * The externals ship inside the VSIX via the .vscodeignore whitelist; the
 * production build stages the root-hoisted ones into vscode/node_modules
 * first (scripts/build-production.js).
 *
 * Bundles OVERWRITE the tsc-emitted entrypoints in out/ (same paths, so
 * package.json `main` and the MCP child spawn path are unchanged). tsc keeps
 * running first for type-checking and the unbundled dev/e2e layout.
 */
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const root_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ENTRYPOINTS = [
  { entry: 'src/extension.ts', out: 'out/extension.js' },
  { entry: 'src/mcp_server_standalone.ts', out: 'out/mcp_server_standalone.js' },
  { entry: 'src/server/server_standalone.ts', out: 'out/server/server_standalone.js' },
];

const EXTERNALS = ['vscode', '@duckdb/node-api', 'patchright'];

for (const { entry, out } of ENTRYPOINTS) {
  await build({
    absWorkingDir: root_dir,
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: EXTERNALS,
    sourcemap: false,
    logLevel: 'info',
  });
}
