import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Application } from 'express';
import request from 'supertest';
import { compress } from '@mongodb-js/zstd';
import { ServerManager } from './server_manager';
import { DatabaseManager } from '../database/database_manager';
import { DuckDB, get_webpage_by_url, get_webpage_capture } from '../duck_db';
import { read_capture } from '../workflow/store_capture';
import { VisitQueueProcessor } from '../visit_queue_processor';
import { md5_hash } from '../hash_utils';

// Use the manual vscode mock deterministically (its getConfiguration returns
// config defaults), regardless of worker file ordering.
jest.mock('vscode');

/**
 * Exercises the real capture seam end to end — real Express ServerManager, real
 * DuckDB on a temp path, the real visit queue and zero-LLM capture pipeline. No
 * LLM, no LanceDB, no network, no API tokens. Posts a genuine zstd visit and
 * asserts the raw page round-trips losslessly from the capture store.
 */
describe('server pipeline integration (real DuckDB, zero-LLM capture)', () => {
  let storage_dir: string;
  let db_manager: DatabaseManager;
  let duck_db: DuckDB;
  let server: ServerManager;
  let app: Application;

  beforeAll(async () => {
    storage_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bergamot-itest-'));

    db_manager = new DatabaseManager();
    const dbs = await db_manager.initialize_all(storage_dir);
    duck_db = dbs.duck_db;

    server = new ServerManager({
      duck_db,
      inbox_dir: path.join(storage_dir, 'visit_inbox'),
      storage_base: storage_dir,
    });
    // Mount routes + queue without binding a port or touching the shared port file.
    server.prepare();
    app = (server as object as { app: Application }).app;
  }, 60000);

  afterAll(async () => {
    server?.get_queue_processor()?.stop();
    await db_manager?.close_all();
    if (storage_dir) {
      fs.rmSync(storage_dir, { recursive: true, force: true });
    }
  });

  it('ingests a posted zstd visit through to the DuckDB capture store', async () => {
    const url = 'https://example.com/integration';
    const page_loaded_at = '2024-01-01T00:00:00.000Z';
    // A normal content page (not an interstitial), so the gate keeps it.
    const html =
      '<html><head><title>Integration</title></head><body><article><h1>Integration</h1><p>' +
      'Real pipeline content stored losslessly by the capture pipeline. '.repeat(8) +
      '</p></article></body></html>';
    const content = (await compress(Buffer.from(html, 'utf-8'))).toString('base64');

    const response = await request(app)
      .post('/visit')
      .send({ url, page_loaded_at, content, referrer: null })
      .expect(200);

    expect(response.body.status).toBe('queued');
    expect(typeof response.body.visit_id).toBe('string');

    await drain_queue(server.get_queue_processor());

    // DuckDB: the session row exists and joins to the capture title (from the
    // cheap <head> metadata — no LLM).
    const row = await get_webpage_by_url(duck_db, url);
    expect(row).not.toBeNull();
    expect(row?.url).toBe(url);
    expect(row?.title).toBe('Integration');

    // Capture store: the raw page round-trips losslessly from webpage_capture —
    // the durable content. Nothing is written to any vector store at ingest.
    const id = md5_hash(`${url}:${page_loaded_at}`);
    const capture_meta = await get_webpage_capture(duck_db, id);
    expect(capture_meta).not.toBeNull();
    expect(capture_meta?.url).toBe(url);
    const recovered = await read_capture(duck_db, id);
    expect(recovered?.html).toBe(html);
  }, 60000);
});

/**
 * Drives the queue to completion without waiting on its batch timer: repeatedly
 * runs a batch until the queue is empty and idle, or a deadline passes.
 */
async function drain_queue(processor: VisitQueueProcessor | undefined): Promise<void> {
  if (!processor) throw new Error('queue processor not started');
  const deadline = Date.now() + 30000;
  for (;;) {
    await processor.process_queue();
    const stats = processor.get_stats();
    if (stats.queue_length === 0 && !stats.is_processing) return;
    if (Date.now() > deadline) throw new Error('queue did not drain in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
