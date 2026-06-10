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
 * The externals ship inside the VSIX via the clean staging directory:
 * scripts/build-production.js copies the bundled out/ plus the externals'
 * transitive closure into builds/staging/node_modules and runs vsce there
 * (see docs/decisions/native-dep-packaging.md).
 *
 * Bundles OVERWRITE the tsc-emitted entrypoints in out/ (same paths, so
 * package.json `main` and the MCP child spawn path are unchanged). tsc runs
 * first for type-checking and the unbundled dev/e2e layout.
 */
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENTRYPOINTS, EXTERNALS } from './bundle_manifest.mjs';

const root_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
