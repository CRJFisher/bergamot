import * as express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { ServerManager, ServerConfig } from './server_manager';
import { DuckDB } from '../duck_db';
import { MarkdownDatabase } from '../markdown_db';
import { LanceDBMemoryStore } from '../lance_db';
import { EpisodicMemoryStore } from '../memory/episodic_memory_store';
import { ProceduralMemoryStore } from '../memory/procedural_memory_store';
import { VisitQueueProcessor } from '../visit_queue_processor';
import { build_workflow } from '../reconcile_webpage_trees_workflow_vanilla';
import { decompress } from '@mongodb-js/zstd';

// Mock dependencies
jest.mock('../duck_db');
jest.mock('../markdown_db');
jest.mock('../lance_db');
jest.mock('../memory/episodic_memory_store');
jest.mock('../memory/procedural_memory_store');
jest.mock('../orphaned_visits');
jest.mock('../visit_queue_processor');
jest.mock('../reconcile_webpage_trees_workflow_vanilla');
jest.mock('../config/filter_config', () => ({
  get_filter_config: jest.fn().mockReturnValue({})
}));
jest.mock('@mongodb-js/zstd');
jest.mock('fs');
jest.mock('../hash_utils', () => ({
  md5_hash: jest.fn().mockReturnValue('test-hash-id')
}));

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
    } as any;

    (VisitQueueProcessor as jest.Mock).mockImplementation(() => mock_queue_processor);

    // Setup mock workflow
    (build_workflow as jest.Mock).mockReturnValue({});

    // Setup mock config
    mock_config = {
      openai_api_key: 'test-api-key',
      duck_db: {} as DuckDB,
      markdown_db: {} as MarkdownDatabase,
      memory_db: {} as LanceDBMemoryStore,
      episodic_store: {} as EpisodicMemoryStore,
      procedural_store: {} as ProceduralMemoryStore
    };

    server_manager = new ServerManager(mock_config);
  });

  afterEach(async () => {
    await server_manager.stop();
  });

  describe('start()', () => {
    it('should start server on dynamic port', async () => {
      const port = await server_manager.start();

      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    });

    it('should write port to file', async () => {
      const mock_write_file_sync = fs.writeFileSync as jest.Mock;
      mock_write_file_sync.mockImplementation(() => {});

      const port = await server_manager.start();

      const expected_path = path.join(os.tmpdir(), 'pkm_assistant_port.txt');
      expect(mock_write_file_sync).toHaveBeenCalledWith(
        expected_path,
        port.toString()
      );
    });

    it('should start queue processor', async () => {
      await server_manager.start();

      expect(VisitQueueProcessor).toHaveBeenCalled();
      expect(mock_queue_processor.start).toHaveBeenCalled();
    });

    it('should setup workflow with correct configuration', async () => {
      await server_manager.start();

      expect(build_workflow).toHaveBeenCalledWith(
        'test-api-key',
        null,
        mock_config.duck_db,
        mock_config.markdown_db,
        mock_config.memory_db,
        expect.any(Object),
        mock_config.episodic_store,
        mock_config.procedural_store
      );
    });
  });

  describe('API endpoints', () => {
    let app: express.Application;

    beforeEach(async () => {
      await server_manager.start();
      // Access the Express app directly for testing
      app = (server_manager as any).app;
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
    });

    describe('POST /visit', () => {
      it('should process valid visit request', async () => {
        const visit_data = {
          url: 'https://example.com',
          page_loaded_at: '2024-01-01T00:00:00Z',
          content: 'test content',
          referrer: null,
          referrer_page_session_id: null
        };

        const response = await request(app)
          .post('/visit')
          .send(visit_data)
          .expect(200);

        expect(response.body).toEqual({
          status: 'queued',
          position: 1
        });

        expect(mock_queue_processor.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-hash-id',
            url: 'https://example.com',
            raw_content: 'test content'
          })
        );
      });

      it('should decompress zstd compressed content', async () => {
        const mock_decompress = decompress as jest.Mock;
        mock_decompress.mockResolvedValue(Buffer.from('decompressed content'));

        const visit_data = {
          url: 'https://example.com',
          page_loaded_at: '2024-01-01T00:00:00Z',
          content: Buffer.from('compressed').toString('base64'),
          referrer: null,
          referrer_page_session_id: null
        };

        await request(app)
          .post('/visit')
          .send(visit_data)
          .expect(200);

        expect(mock_decompress).toHaveBeenCalled();
        expect(mock_queue_processor.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            raw_content: 'decompressed content'
          })
        );
      });

      it('should handle decompression failure gracefully', async () => {
        const mock_decompress = decompress as jest.Mock;
        mock_decompress.mockRejectedValue(new Error('Decompression failed'));

        const visit_data = {
          url: 'https://example.com',
          page_loaded_at: '2024-01-01T00:00:00Z',
          content: 'not-compressed-content',
          referrer: null,
          referrer_page_session_id: null
        };

        const response = await request(app)
          .post('/visit')
          .send(visit_data)
          .expect(200);

        expect(response.body.status).toBe('queued');
        expect(mock_queue_processor.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            raw_content: 'not-compressed-content'
          })
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

  describe('without memory features', () => {
    it('should work without episodic and procedural stores', async () => {
      const config_without_memory: ServerConfig = {
        openai_api_key: 'test-api-key',
        duck_db: {} as DuckDB,
        markdown_db: {} as MarkdownDatabase,
        memory_db: {} as LanceDBMemoryStore
      };

      const server_without_memory = new ServerManager(config_without_memory);
      const port = await server_without_memory.start();

      expect(port).toBeGreaterThan(0);
      expect(build_workflow).toHaveBeenCalledWith(
        'test-api-key',
        null,
        config_without_memory.duck_db,
        config_without_memory.markdown_db,
        config_without_memory.memory_db,
        expect.any(Object),
        undefined,
        undefined
      );

      await server_without_memory.stop();
    });
  });
});