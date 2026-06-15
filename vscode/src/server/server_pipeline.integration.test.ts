import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Application } from 'express';
import request from 'supertest';
import { ServerManager } from './server_manager';
import { DatabaseManager } from '../database/database_manager';
import { DuckDB, get_webpage_by_url, get_webpage_capture } from '../duck_db';
import { VisitQueueProcessor } from '../visit_queue_processor';
import { md5_hash } from '../hash_utils';

// Use the manual vscode mock deterministically (its getConfiguration returns
// config defaults), regardless of worker file ordering.
jest.mock('vscode');

/**
 * Exercises the real capture seam end to end — real Express ServerManager, real
 * DuckDB on a temp path, the real visit queue and capture pipeline. Posts a
 * metadata-only visit and asserts the visit is ingested to a metadata row with
 * zero stored page content.
 */
describe('server pipeline integration (real DuckDB, capture pipeline)', () => {
  let storage_dir: string;
  let db_manager: DatabaseManager;
  let duck_db: DuckDB;
  let server: ServerManager;
  let app: Application;

  beforeAll(async () => {
    storage_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bergamot-itest-'));

    db_manager = new DatabaseManager();
    const dbs = await db_manager.initialize_all(
      storage_dir,
      '0123456789abcdef'.repeat(4)
    );
    duck_db = dbs.duck_db;

    server = new ServerManager({
      duck_db,
      storage_base: storage_dir,
    });
    // Mount routes + queue without binding a port or touching the shared port file.
    await server.prepare();
    app = (server as object as { app: Application }).app;
  }, 60000);

  afterAll(async () => {
    server?.get_queue_processor()?.stop();
    await db_manager?.close_all();
    if (storage_dir) {
      fs.rmSync(storage_dir, { recursive: true, force: true });
    }
  });

  it('ingests a posted metadata-only visit through to the DuckDB capture store', async () => {
    const url = 'https://example.com/integration';
    const page_loaded_at = '2024-01-01T00:00:00.000Z';

    const response = await request(app)
      .post('/visit')
      .send({ url, page_loaded_at, title: 'Integration', referrer: null })
      .expect(200);

    expect(response.body.status).toBe('queued');
    expect(typeof response.body.visit_id).toBe('string');

    await drain_queue(server.get_queue_processor());

    // DuckDB: the session row exists and joins to the capture title (captured
    // from the browser tab and threaded through).
    const row = await get_webpage_by_url(duck_db, url);
    expect(row).not.toBeNull();
    expect(row?.url).toBe(url);
    expect(row?.title).toBe('Integration');

    // Capture store: the metadata row exists for this visit. Page content is
    // obtained by re-downloading the public URL (task-39.2), not from this store.
    const id = md5_hash(`${url}:${page_loaded_at}`);
    const capture_meta = await get_webpage_capture(duck_db, id);
    expect(capture_meta).not.toBeNull();
    expect(capture_meta?.url).toBe(url);
    expect(capture_meta?.title).toBe('Integration');
  }, 60000);

  it('stores zero page content — webpage_capture has no content column (AC#6)', async () => {
    const url = 'https://example.com/no-content';
    const page_loaded_at = '2024-02-02T00:00:00.000Z';

    await request(app)
      .post('/visit')
      .send({ url, page_loaded_at, title: 'No Content', referrer: null })
      .expect(200);
    await drain_queue(server.get_queue_processor());

    // The metadata row was stored (so the assertion below is not vacuous).
    const id = md5_hash(`${url}:${page_loaded_at}`);
    expect(await get_webpage_capture(duck_db, id)).not.toBeNull();

    // The webpage_capture table itself carries no content column of any kind —
    // browsing produces zero stored page content.
    const columns = await duck_db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'webpage_capture'`
    );
    const names = columns.map((c) => String(c.column_name));
    expect(names).toEqual(
      expect.arrayContaining([
        'page_session_id',
        'url',
        'title',
        'content_type',
        'captured_at',
      ])
    );
    expect(names).not.toContain('content_compressed');
    expect(names.some((n) => n.startsWith('content') && n !== 'content_type')).toBe(
      false
    );
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
