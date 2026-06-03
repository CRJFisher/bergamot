#!/usr/bin/env node

/**
 * On-demand full-pipeline E2E harness.
 *
 * Exercises the real seam end to end, offline and free:
 *   real extension (plain build, real port discovery)
 *     → live Bergamot capture server (headless, fake LLM + fake embeddings)
 *       → DuckDB + LanceDB
 *
 * Steps:
 *   1. compile the VS Code extension (produces out/server/server_standalone.js)
 *   2. build the browser extension plainly into chrome/dist (NOT build:test —
 *      that bakes MOCK_PKM_PORT and skips real discovery)
 *   3. start the headless capture server (BERGAMOT_LLM=fake, temp storage)
 *   4. run the full_pipeline Playwright spec against it
 *   5. tear the server down and clean up
 *
 * Usage: node scripts/run-pipeline-e2e.mjs   (from the repo root)
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VSCODE_DIR = path.join(ROOT, 'vscode');
const BROWSER_DIR = path.join(ROOT, 'browser');
const PORT_FILE = path.join(os.homedir(), '.bergamot', 'port.json');

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}   (in ${path.relative(ROOT, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

async function wait_for_server(server_log, deadline_ms) {
  const deadline = Date.now() + deadline_ms;
  while (Date.now() < deadline) {
    if (/listening on http:\/\/localhost:\d+/.test(server_log.text)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start in time. Log:\n${server_log.text}`);
}

async function main() {
  // A running extension owns ~/.bergamot/port.json; back it up so we can restore.
  const had_port_file = fs.existsSync(PORT_FILE);
  const port_backup = had_port_file ? fs.readFileSync(PORT_FILE) : null;

  const storage_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bergamot-e2e-'));
  let server;

  try {
    run('npm run compile', VSCODE_DIR);
    // Plain build → dist, postbuild copies into chrome/dist for the loader.
    run('npm run build', BROWSER_DIR);

    const server_log = { text: '' };
    console.log('\nStarting headless capture server (fake LLM + embeddings)...');
    server = spawn(
      'node',
      [
        '--import',
        path.join(VSCODE_DIR, 'scripts', 'vscode-shim.mjs'),
        path.join(VSCODE_DIR, 'out', 'server', 'server_standalone.js'),
      ],
      {
        cwd: VSCODE_DIR,
        env: { ...process.env, BERGAMOT_LLM: 'fake', STORAGE_PATH: storage_dir },
      }
    );
    const capture = (buf) => {
      server_log.text += buf.toString();
      process.stdout.write(`[server] ${buf}`);
    };
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);

    await wait_for_server(server_log, 30_000);

    run('npx playwright test --config playwright.pipeline.config.ts', BROWSER_DIR);

    console.log('\n✅ Full-pipeline E2E passed.');
  } finally {
    if (server) {
      server.kill('SIGTERM');
    }
    fs.rmSync(storage_dir, { recursive: true, force: true });
    // Restore (or remove) the canonical port file we may have overwritten.
    if (port_backup) {
      fs.writeFileSync(PORT_FILE, port_backup);
    } else if (fs.existsSync(PORT_FILE)) {
      fs.rmSync(PORT_FILE, { force: true });
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Full-pipeline E2E failed:', error.message);
  process.exit(1);
});
