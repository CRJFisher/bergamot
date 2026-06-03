#!/usr/bin/env node

/**
 * Headless entrypoint for the capture server, mirroring `mcp_server_standalone`.
 *
 * Runs the real `ServerManager` (Express + visit queue + classification
 * workflow + DuckDB/LanceDB) outside the VS Code extension host, so the
 * full-pipeline E2E harness can exercise the live seam (browser → discovery →
 * server → DBs) without launching the editor.
 *
 * Environment:
 *  - STORAGE_PATH  (required) base dir for DuckDB/LanceDB/inbox
 *  - BERGAMOT_LLM=fake  use the offline fake LLM + embeddings (no network/tokens)
 *  - BERGAMOT_LLM_PROVIDER  claude|openai|vscode (default claude)
 *  - OPENAI_API_KEY  only when the provider is openai
 */

import { DatabaseManager } from '../database/database_manager';
import { ServerManager } from './server_manager';
import { init_dev_log } from '../dev_log';
import { LlmProvider } from '../config/config_manager';
import * as path from 'path';

async function main(): Promise<void> {
  const storage_path = process.env.STORAGE_PATH;
  if (!storage_path) {
    console.error('Missing required environment variable: STORAGE_PATH');
    process.exit(1);
  }

  const provider = (process.env.BERGAMOT_LLM_PROVIDER as LlmProvider) || 'claude';

  // Dev logging on by default for the headless server (it exists for debugging).
  init_dev_log(storage_path, true);

  const db_manager = new DatabaseManager();
  const databases = await db_manager.initialize_all(storage_path);

  const server = new ServerManager({
    openai_api_key: process.env.OPENAI_API_KEY ?? '',
    duck_db: databases.duck_db,
    memory_db: databases.memory_db,
    inbox_dir: path.join(storage_path, 'visit_inbox'),
    storage_base: storage_path,
    llm_provider: provider,
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
