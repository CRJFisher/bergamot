#!/usr/bin/env node

/**
 * One-command Brave dev loop.
 *
 * - Bundles content + background scripts straight into `chrome/dist` (what the
 *   unpacked extension loads), so there is no copy step to race the watcher.
 * - Starts an esbuild watch on both bundles.
 * - Launches Brave with its own persistent dev profile, loading the extension.
 *
 * Uses plain `build` semantics (NOT `build:test`): `build:test` injects a
 * `MOCK_PKM_PORT` and short-circuits real-server discovery, which would defeat
 * the point of exercising the live VS Code server.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { launchChrome } from './load-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'chrome', 'dist');

const BRAVE_BIN = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

const BUILDS = [
  {
    entryPoints: [path.join(ROOT, 'src', 'content.ts')],
    outfile: path.join(OUT_DIR, 'content.bundle.js'),
    format: 'iife',
  },
  {
    entryPoints: [path.join(ROOT, 'src', 'background.ts')],
    outfile: path.join(OUT_DIR, 'background.bundle.js'),
    format: 'esm',
  },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Build each bundle once up front, THEN start watching. ctx.watch() resolves
  // as soon as the watcher is armed and does not guarantee the first build has
  // landed on disk, so an explicit rebuild() ensures chrome/dist is populated
  // before Brave loads the extension.
  for (const build of BUILDS) {
    const ctx = await esbuild.context({
      entryPoints: build.entryPoints,
      bundle: true,
      outfile: build.outfile,
      format: build.format,
      allowOverwrite: true,
      logLevel: 'info',
    });
    await ctx.rebuild();
    await ctx.watch();
  }

  console.log('👀 esbuild watching → chrome/dist (content + background)');

  // Pin Brave and launch via the shared loader. BROWSER_BIN takes priority and
  // the loader gives Brave its own persistent profile automatically.
  if (!fs.existsSync(BRAVE_BIN) && !process.env.BROWSER_BIN) {
    console.error(`❌ Brave not found at ${BRAVE_BIN}. Set BROWSER_BIN to override.`);
    process.exit(1);
  }
  process.env.BROWSER_BIN = process.env.BROWSER_BIN || BRAVE_BIN;

  launchChrome();
}

main().catch((error) => {
  console.error('❌ dev:brave failed:', error);
  process.exit(1);
});
