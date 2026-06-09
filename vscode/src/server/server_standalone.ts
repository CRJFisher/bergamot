#!/usr/bin/env node

/**
 * Headless entrypoint for the capture server, mirroring `mcp_server_standalone`.
 *
 * Runs the real `ServerManager` (Express + visit queue + capture pipeline
 * + DuckDB) outside the VS Code extension host, so the full-pipeline
 * E2E harness can exercise the live seam (browser → discovery → server → DB)
 * without launching the editor.
 *
 * Environment:
 *  - STORAGE_PATH            (required) base dir for DuckDB + the visit inbox
 *  - STORAGE_ENCRYPTION_KEY  (required) at-rest encryption key for the DuckDB
 *    store: 64 lowercase hex chars (32 random bytes). Headless runs have no
 *    VS Code SecretStorage, so the harness that spawns this process generates
 *    a per-run throwaway key. The extension's own store can never be opened
 *    here — its key lives in SecretStorage and is not exportable — so this
 *    entrypoint only ever serves per-run, throwaway stores.
 */

import { DatabaseManager } from '../database/database_manager';
import { ServerManager } from './server_manager';
import { init_dev_log } from '../dev_log';
import * as path from 'path';

async function main(): Promise<void> {
  const storage_path = process.env.STORAGE_PATH;
  if (!storage_path) {
    console.error('Missing required environment variable: STORAGE_PATH');
    process.exit(1);
  }
  const encryption_key = process.env.STORAGE_ENCRYPTION_KEY;
  if (!encryption_key) {
    console.error('Missing required environment variable: STORAGE_ENCRYPTION_KEY');
    process.exit(1);
  }

  // Dev logging on by default for the headless server (it exists for debugging).
  init_dev_log(storage_path, true);

  const db_manager = new DatabaseManager();
  const databases = await db_manager.initialize_all(storage_path, encryption_key);

  const server = new ServerManager({
    duck_db: databases.duck_db,
    inbox_dir: path.join(storage_path, 'visit_inbox'),
    storage_base: storage_path,
  });

  const port = await server.start();
  console.log(`[bergamot] headless server listening on http://localhost:${port}`);

  const shutdown = async () => {
    console.log('[bergamot] shutting down headless server...');
    await server.stop();
    await db_manager.close_all();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[bergamot] headless server failed:', error);
  process.exit(1);
});
