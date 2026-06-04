#!/usr/bin/env node

/**
 * One-command Brave dev loop.
 *
 * - Bundles content + background scripts straight into `chrome/dist` (what the
 *   unpacked extension loads), so there is no copy step to race the watcher.
 * - Starts an esbuild watch on both bundles.
 * - Launches Brave with its own persistent dev profile, loading the extension.
 * - Hot-reloads the extension over CDP after every rebuild: it evaluates
 *   `chrome.runtime.reload()` in the background service worker and refreshes open
 *   http(s) tabs, so the latest content + background code goes live WITHOUT
 *   restarting Brave. The browser instance, profile, devtools, and login survive.
 *
 * Uses plain `build` semantics (NOT `build:test`): `build:test` injects a
 * `MOCK_PKM_PORT` and short-circuits real-server discovery, which would defeat
 * the point of exercising the live VS Code server.
 */

/* global WebSocket */
// WebSocket and fetch are Node 22 globals (used for the CDP hot-reload below).

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { launchChrome } from './load-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'chrome', 'dist');

const BRAVE_BIN = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

// CDP endpoint Brave exposes for hot-reload. Overridable if 9222 is in use.
const CDP_PORT = Number(process.env.BERGAMOT_CDP_PORT) || 9222;

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The persistent dev profile this loop uses; also the unique marker we match to
// kill a stale debug Brave (see kill_stale_brave).
const DEBUG_PROFILE_MARKER = 'bergamot-brave-debug-profile';

// Kill any Brave still running on the debug profile. A persistent-profile relaunch
// otherwise hands off to the surviving browser process, which keeps the OLD MV3
// service worker and ignores the freshly-built bundles on disk. Matched strictly
// to the dev profile so a normal Brave (different profile) is never touched.
async function kill_stale_brave() {
  try {
    execSync(`pkill -f ${DEBUG_PROFILE_MARKER}`, { stdio: 'ignore' });
    // Give the process time to exit and release the profile's SingletonLock and
    // the CDP port before the fresh launch.
    await delay(1500);
  } catch {
    // pkill exits non-zero when nothing matched — that is the normal case.
  }
}

// --- CDP hot-reload ---------------------------------------------------------

async function cdp_targets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  return res.json();
}

// Send one CDP command over a target's debugger WebSocket and resolve on its
// reply. Resolves null on timeout/error — `chrome.runtime.reload()` tears down
// the service worker before it can answer, which is expected, not a failure.
function cdp_send(ws_url, method, params = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(ws_url);
    const finish = (value) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 2000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id === 1) finish(message);
    });
    ws.addEventListener('error', () => finish(null));
  });
}

async function reload_extension() {
  let targets;
  try {
    targets = await cdp_targets();
  } catch {
    console.warn('⚠️  CDP not reachable; skipping hot-reload');
    return;
  }

  const service_worker = targets.find(
    (t) => t.type === 'service_worker' && /background\.bundle\.js/.test(t.url)
  );
  if (!service_worker) {
    console.warn('⚠️  extension service worker not found; skipping hot-reload');
    return;
  }

  // Reload the extension itself: swaps the background code and re-registers the
  // content scripts. Attaching to the target wakes a dormant MV3 worker.
  await cdp_send(service_worker.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: 'chrome.runtime.reload()',
  });

  // Let the new worker register, then refresh open http(s) tabs so the latest
  // content script injects into pages that are already open.
  await delay(400);
  const pages = (await cdp_targets()).filter(
    (t) => t.type === 'page' && /^https?:/.test(t.url)
  );
  await Promise.all(pages.map((p) => cdp_send(p.webSocketDebuggerUrl, 'Page.reload', {})));
  console.log(`🔁 extension hot-reloaded (${pages.length} tab(s) refreshed)`);
}

let ready = false;
let reload_timer = null;

// The two bundles finish on slightly different ticks; debounce so a burst of
// rebuilds collapses into a single extension reload.
function schedule_reload() {
  if (!ready) return;
  clearTimeout(reload_timer);
  reload_timer = setTimeout(() => {
    reload_extension().catch((error) => console.warn('⚠️  hot-reload failed:', error.message));
  }, 200);
}

const hot_reload_plugin = {
  name: 'bergamot-hot-reload',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) schedule_reload();
    });
  },
};

// Poll the CDP endpoint until Brave is ready to accept hot-reload commands.
async function wait_for_cdp(timeout_ms = 15000) {
  const deadline = Date.now() + timeout_ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return true;
    } catch {
      /* CDP not up yet */
    }
    await delay(300);
  }
  console.warn('⚠️  CDP endpoint never came up; hot-reload disabled this run');
  return false;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Build each bundle once up front, THEN start watching. ctx.watch() resolves
  // as soon as the watcher is armed and does not guarantee the first build has
  // landed on disk, so an explicit rebuild() ensures chrome/dist is populated
  // before Brave loads the extension. The initial rebuild fires onEnd while
  // `ready` is false, so it does not trigger a (premature) hot-reload.
  for (const build of BUILDS) {
    const ctx = await esbuild.context({
      entryPoints: build.entryPoints,
      bundle: true,
      outfile: build.outfile,
      format: build.format,
      allowOverwrite: true,
      logLevel: 'info',
      plugins: [hot_reload_plugin],
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
  // Hand the CDP port to the loader so Brave launches with remote debugging.
  process.env.BERGAMOT_CDP_PORT = String(CDP_PORT);

  // Guarantee this launch loads the freshly-built bundles (and a clean service
  // worker) rather than handing off to a stale instance.
  await kill_stale_brave();

  launchChrome();

  if (await wait_for_cdp()) {
    ready = true;
    // Push the freshly-built bundles into the browser now, so restarting the
    // launch config refreshes the extension even when Brave handed off to an
    // already-running instance — a persistent-profile relaunch does not reload
    // the extension on its own.
    await reload_extension();
    console.log('🔁 hot-reload armed — saving a source file reloads the extension in place');
  }
}

main().catch((error) => {
  console.error('❌ dev:brave failed:', error);
  process.exit(1);
});
