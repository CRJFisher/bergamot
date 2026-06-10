/**
 * Single source of truth for the packaging contract: which entrypoints are
 * bundled and which modules stay external (and therefore ship as staged
 * node_modules in the VSIX). Consumed by bundle.mjs (build),
 * check-bundle-externals.mjs (guard), and build-production.js (staging) so
 * the three can never drift.
 */
export const ENTRYPOINTS = [
  { entry: 'src/extension.ts', out: 'out/extension.js' },
  { entry: 'src/mcp_server_standalone.ts', out: 'out/mcp_server_standalone.js' },
  { entry: 'src/server/server_standalone.ts', out: 'out/server/server_standalone.js' },
];

/**
 * `vscode` is extension-host-provided; `@duckdb/node-api` loads a native
 * binding; `patchright` carries browser registry assets and dynamic requires;
 * `defuddle` is resolved and required by absolute path at runtime (its ESM-only
 * `./node` subpath, which esbuild must not inline) and pulls `linkedom` +
 * `turndown` for string-input DOM parsing and HTML→markdown. All but `vscode`
 * are staged into the VSIX with their transitive closure.
 */
export const EXTERNALS = [
  'vscode',
  '@duckdb/node-api',
  'patchright',
  'defuddle',
  'linkedom',
  'turndown',
];

/** The external packages staged into the VSIX (vscode is host-provided). */
export const SHIPPED_EXTERNALS = [
  '@duckdb/node-api',
  'patchright',
  'defuddle',
  'linkedom',
  'turndown',
];
