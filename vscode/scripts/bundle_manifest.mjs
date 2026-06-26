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
  // The off-thread TDT clustering worker (TASK-36.9), forked by the extension
  // host. Its own bundle so the clustering-tfjs / TensorFlow chain loads only in
  // the child process, never in the extension host.
  { entry: 'src/tdt/cluster_worker.ts', out: 'out/tdt/cluster_worker.js' },
];

/**
 * `vscode` is extension-host-provided; `@duckdb/node-api` loads a native
 * binding; `patchright` carries browser registry assets and dynamic requires;
 * `defuddle` is resolved and required by absolute path at runtime (its ESM-only
 * `./node` subpath, which esbuild must not inline) and pulls `linkedom` +
 * `turndown` for string-input DOM parsing and HTML→markdown;
 * `@huggingface/transformers` (the TDT page embedder) dynamically requires
 * `onnxruntime-node`'s native binding and resolves on-disk model/wasm assets, so
 * both stay external. `@tensorflow/tfjs-node` (the clustering-tfjs backend the
 * forked clustering worker loads) carries a native `.node` addon and is
 * auto-probed by a dynamic require, so it and `clustering-tfjs` stay external
 * too. All but `vscode` are staged into the VSIX with their transitive closure.
 */
export const EXTERNALS = [
  'vscode',
  '@duckdb/node-api',
  'patchright',
  'defuddle',
  'linkedom',
  'turndown',
  '@huggingface/transformers',
  'onnxruntime-node',
  '@tensorflow/tfjs-node',
  'clustering-tfjs',
];

/** The external packages staged into the VSIX (vscode is host-provided). */
export const SHIPPED_EXTERNALS = [
  '@duckdb/node-api',
  'patchright',
  'defuddle',
  'linkedom',
  'turndown',
  '@huggingface/transformers',
  'onnxruntime-node',
  '@tensorflow/tfjs-node',
  'clustering-tfjs',
];
