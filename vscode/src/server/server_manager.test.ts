import * as express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { ServerManager, ServerConfig, SERVER_PORT_RANGE } from './server_manager';
import { DuckDB } from '../duck_db';
import { VisitQueueProcessor } from '../visit_queue_processor';
import { dev_log } from '../dev_log';

// Mock dependencies
jest.mock('../duck_db');
jest.mock('../orphaned_visits');
jest.mock('../visit_queue_processor');
jest.mock('fs');
jest.mock('../hash_utils', () => ({
  md5_hash: jest.fn().mockReturnValue('test-hash-id')
}));
// Keep the real stage validator; spy on the sink so we can assert what is logged.
jest.mock('../dev_log', () => {
  const actual = jest.requireActual('../dev_log');
  return { ...actual, dev_log: jest.fn() };
});

describe('ServerManager', () => {
  let server_manager: ServerManager;
  let mock_config: ServerConfig;
  let mock_queue_processor: jest.Mocked<VisitQueueProcessor>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock queue processor
    mock_queue_processor = {
      start: jest.fn(),
      stop: jest.fn(),
      enqueue: jest.fn().mockReturnValue(1)
    } as Partial<jest.Mocked<VisitQueueProcessor>> as jest.Mocked<VisitQueueProcessor>;

    (VisitQueueProcessor as jest.Mock).mockImplementation(() => mock_queue_processor);

    // Setup mock config
    mock_config = {
      duck_db: {} as DuckDB,
    };

    server_manager = new ServerManager(mock_config);
  });

  afterEach(async () => {
    await server_manager.stop();
  });

  describe('start()', () => {
    it('should bind a port within the candidate range', async () => {
      const port = await server_manager.start();

      expect(SERVER_PORT_RANGE).toContain(port);
    });

    it('should write the bound port to the canonical port file', async () => {
      const mock_write_file_sync = fs.writeFileSync as jest.Mock;
      mock_write_file_sync.mockImplementation(() => {});

      const port = await server_manager.start();

      const expected_path = path.join(os.homedir(), '.bergamot', 'port.json');
      expect(mock_write_file_sync).toHaveBeenCalledWith(
        expected_path,
        JSON.stringify({ port, pid: process.pid }, null, 2)
      );
    });

    it('should start queue processor', async () => {
      await server_manager.start();

      expect(VisitQueueProcessor).toHaveBeenCalled();
      expect(mock_queue_processor.start).toHaveBeenCalled();
    });

    it('should wire the DuckDB handle into the queue processor', async () => {
      await server_manager.start();

      expect(VisitQueueProcessor).toHaveBeenCalledWith(
        mock_config.duck_db,
        expect.anything(),
        expect.objectContaining({ batch_size: 3 })
      );
    });
  });

  describe('API endpoints', () => {
    let app: express.Application;

    beforeEach(async () => {
      await server_manager.start();
      // Access the Express app directly for testing
      app = (server_manager as object as { app: express.Application }).app;
    });

    describe('GET /status', () => {
      it('should return server status', async () => {
        const response = await request(app)
          .get('/status')
          .expect(200);

        expect(response.body).toHaveProperty('status', 'running');
        expect(response.body).toHaveProperty('version', '1.0.0');
        expect(response.body).toHaveProperty('uptime');
        expect(typeof response.body.uptime).toBe('number');
      });

      it('reports the bergamot service marker the browser discovery probes for', async () => {
        const response = await request(app).get('/status').expect(200);
        expect(response.body.service).toBe('bergamot');
      });
    });

    describe('POST /shutdown', () => {
      it('acknowledges and tears the server down so a newer host can claim the port', async () => {
        // Stub the teardown so the scheduled shutdown does not race afterEach's
        // real stop(); afterEach (post-restore) performs the actual teardown.
        const stop_spy = jest
          .spyOn(server_manager, 'stop')
          .mockResolvedValue(undefined);

        const response = await request(app).post('/shutdown').expect(200);
        expect(response.body).toEqual({ status: 'shutting_down' });

        // The teardown is scheduled after the reply flushes; let the setImmediate
        // run, then confirm the server stopped itself.
        await new Promise((resolve) => setImmediate(resolve));
        expect(stop_spy).toHaveBeenCalled();

        stop_spy.mockRestore();
      });
    });

    describe('POST /dev_signal', () => {
      it('logs a recognized browser stage to the dev-log sink', async () => {
        const response = await request(app)
          .post('/dev_signal')
          .send({
            stage: 'capture_attempted',
            fields: { url: 'https://leidendeclaration.ai/', visit_id: 'v1' },
          })
          .expect(200);

        expect(response.body).toEqual({ ok: true });
        expect(dev_log).toHaveBeenCalledWith('capture_attempted', {
          source: 'browser',
          url: 'https://leidendeclaration.ai/',
          visit_id: 'v1',
        });
      });

      it('ignores an unknown stage but still acknowledges', async () => {
        const response = await request(app)
          .post('/dev_signal')
          .send({ stage: 'totally_made_up', fields: { url: 'https://x.test/' } })
          .expect(200);

        expect(response.body).toEqual({ ok: true });
        expect(dev_log).not.toHaveBeenCalled();
      });
    });

    describe('POST /visit', () => {
      it('should process a valid metadata-only visit request', async () => {
        const visit_data = {
          url: 'https://example.com',
          page_loaded_at: '2024-01-01T00:00:00Z',
          title: 'Example Page',
          referrer: null,
          referrer_page_session_id: null
        };

        const response = await request(app)
          .post('/visit')
          .send(visit_data)
          .expect(200);

        // With no browser-supplied visit_id, the server falls back to the
        // deterministic url+timestamp hash and echoes it back.
        expect(response.body).toEqual({
          status: 'queued',
          position: 1,
          visit_id: 'test-hash-id'
        });

        // The page title is threaded onto the queued visit; no content field.
        const enqueued = mock_queue_processor.enqueue.mock.calls[0][0];
        expect(enqueued).toEqual(
          expect.objectContaining({
            id: 'test-hash-id',
            visit_id: 'test-hash-id',
            url: 'https://example.com',
            title: 'Example Page'
          })
        );
        expect('content' in enqueued).toBe(false);
        expect('raw_content' in enqueued).toBe(false);
      });

      it('defaults the title to empty string when the browser omits it', async () => {
        const visit_data = {
          url: 'https://example.com',
          page_loaded_at: '2024-01-01T00:00:00Z',
          referrer: null,
          referrer_page_session_id: null
        };

        await request(app).post('/visit').send(visit_data).expect(200);

        expect(mock_queue_processor.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ title: '' })
        );
      });

      it('echoes a browser-supplied visit_id back and threads it into the queued visit', async () => {
        const visit_data = {
          url: 'https://example.com',
          page_loaded_at: '2024-01-01T00:00:00Z',
          title: 'Example Page',
          referrer: null,
          referrer_page_session_id: null,
          visit_id: 'browser-supplied-visit-id',
        };

        const response = await request(app)
          .post('/visit')
          .send(visit_data)
          .expect(200);

        // The browser-supplied correlation token is trusted and echoed back,
        // not replaced by the server's hash fallback.
        expect(response.body.visit_id).toBe('browser-supplied-visit-id');
        expect(mock_queue_processor.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ visit_id: 'browser-supplied-visit-id' })
        );
      });

      it('should return 400 for invalid payload', async () => {
        const invalid_data = {
          url: 'not-a-valid-url',
          // Missing required fields
        };

        const response = await request(app)
          .post('/visit')
          .send(invalid_data)
          .expect(400);

        expect(response.body).toHaveProperty('error', 'Invalid payload');
        expect(response.body).toHaveProperty('issues');
        expect(mock_queue_processor.enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe('stop()', () => {
    it('should stop queue processor', async () => {
      await server_manager.start();
      await server_manager.stop();

      expect(mock_queue_processor.stop).toHaveBeenCalled();
    });

    it('should handle stop when not started', async () => {
      await expect(server_manager.stop()).resolves.not.toThrow();
    });

    it('should close server connection', async () => {
      await server_manager.start();
      
      // Verify server is running
      const queue_processor = server_manager.get_queue_processor();
      expect(queue_processor).toBeDefined();

      await server_manager.stop();

      // After stop, attempting to access should not throw but server should be closed
      await expect(server_manager.stop()).resolves.not.toThrow();
    });
  });

  describe('get_queue_processor()', () => {
    it('should return undefined before start', () => {
      expect(server_manager.get_queue_processor()).toBeUndefined();
    });

    it('should return queue processor after start', async () => {
      await server_manager.start();

      const processor = server_manager.get_queue_processor();
      expect(processor).toBeDefined();
      expect(processor).toBe(mock_queue_processor);
    });
  });
});