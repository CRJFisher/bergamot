/**
 * Minimal `vscode` stub for running extension code in a plain Node process
 * (the headless capture server / E2E harness). Preload it before the entrypoint:
 *
 *   node --import ./scripts/vscode-shim.mjs out/server/server_standalone.js
 *
 * It satisfies the handful of `vscode` APIs the server path touches:
 * `workspace.getConfiguration` (returns config defaults) and
 * `window.createOutputChannel` (a no-op channel). The real editor provides the
 * genuine module when the extension runs in the host.
 *
 * Patching the CommonJS loader from ESM is fine: the compiled extension is
 * CommonJS, so its `require('vscode')` flows through `Module._load`.
 */

import { Module } from 'node:module';

const original_load = Module._load;

const stub = {
  workspace: {
    getConfiguration: () => ({
      get: (_key, default_value) => default_value,
    }),
  },
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      clear: () => {},
    }),
    showErrorMessage: () => {},
    showInformationMessage: () => {},
  },
};

Module._load = function (request) {
  if (request === 'vscode') {
    return stub;
  }
  return original_load.apply(this, arguments);
};
