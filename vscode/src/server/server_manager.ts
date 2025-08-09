import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from 'http';
import { decompress } from '@mongodb-js/zstd';
import { md5_hash } from '../hash_utils';
import { DuckDB } from '../duck_db';
import { MarkdownDatabase } from '../markdown_db';
import { LanceDBMemoryStore } from '../lance_db';
import { EpisodicMemoryStore } from '../memory/episodic_memory_store';
import { ProceduralMemoryStore } from '../memory/procedural_memory_store';
import { OrphanedVisitsManager } from '../orphaned_visits';
import { VisitQueueProcessor, ExtendedPageVisit } from '../visit_queue_processor';
import { PageActivitySessionWithoutTreeOrContentSchema } from '../duck_db_models';
import { build_workflow } from '../reconcile_webpage_trees_workflow_vanilla';
import { get_filter_config } from '../config/filter_config';

/**
 * Configuration for the server manager.
 */
export interface ServerConfig {
  openai_api_key: string;
  duck_db: DuckDB;
  markdown_db: MarkdownDatabase;
  memory_db: LanceDBMemoryStore;
  episodic_store?: EpisodicMemoryStore;
  procedural_store?: ProceduralMemoryStore;
}

/**
 * Manages the Express server for handling webpage categorization requests.
 */
export class ServerManager {
  private server?: Server;
  private queue_processor?: VisitQueueProcessor;
  private app: express.Application;
  private webpage_categoriser_app: any;

  constructor(private config: ServerConfig) {
    this.app = express();
    this.setup_middleware();
    this.setup_workflow();
  }

  /**
   * Sets up Express middleware.
   */
  private setup_middleware(): void {
    this.app.use(express.json());
    this.app.use(cors());
  }

  /**
   * Sets up the workflow for webpage categorization.
   */
  private setup_workflow(): void {
    const filter_config = get_filter_config();
    this.webpage_categoriser_app = build_workflow(
      this.config.openai_api_key,
      null, // checkpointer no longer used
      this.config.duck_db,
      this.config.markdown_db,
      this.config.memory_db,
      filter_config,
      this.config.episodic_store,
      this.config.procedural_store
    );
  }

  /**
   * Sets up the queue processor for handling visits.
   */
  private setup_queue_processor(): void {
    const orphan_manager = new OrphanedVisitsManager();
    this.queue_processor = new VisitQueueProcessor(
      this.config.duck_db,
      this.config.memory_db,
      this.webpage_categoriser_app,
      orphan_manager,
      {
        batch_size: 3,
        batch_timeout: 1000,
        orphan_retry_interval: 5000
      }
    );
    this.queue_processor.start();
  }

  /**
   * Sets up API routes.
   */
  private setup_routes(): void {
    // Health check endpoint
    this.app.get('/status', (req, res) => {
      res.json({
        status: 'running',
        version: '1.0.0',
        uptime: process.uptime(),
      });
    });

    // Visit processing endpoint
    this.app.post('/visit', async (req, res) => {
      console.log('Received request from:', req.body.url);
      const id = md5_hash(`${req.body.url}:${req.body.page_loaded_at}`);

      // Decompress content if it's base64 encoded zstd compressed data
      let content = req.body.content;
      if (typeof content === 'string' && content.length > 0) {
        try {
          const compressed_data = Buffer.from(content, 'base64');
          const decompressed_data = await decompress(compressed_data);
          content = decompressed_data.toString('utf-8');
        } catch (error) {
          console.warn('Failed to decompress content, using as-is:', error);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { content: _, ...req_body_without_content } = req.body;
      const parse_result = PageActivitySessionWithoutTreeOrContentSchema.safeParse({
        ...req_body_without_content,
        id,
      });

      if (!parse_result.success) {
        res.status(400).json({ 
          error: 'Invalid payload', 
          issues: parse_result.error.issues 
        });
        return;
      }

      const payload = parse_result.data;
      console.log('Received payload:', payload.url);

      // Add to queue instead of processing immediately
      const extended_visit: ExtendedPageVisit = { 
        ...payload, 
        raw_content: content 
      };
      const position = this.queue_processor?.enqueue(extended_visit) ?? 0;

      res.json({ status: 'queued', position });
    });
  }

  /**
   * Writes the server port to a file for the native messaging host.
   * 
   * @param port - The port number to write
   */
  private write_port_file(port: number): void {
    const port_file_path = path.join(os.tmpdir(), 'pkm_assistant_port.txt');
    fs.writeFileSync(port_file_path, port.toString());
    console.log(`Port written to ${port_file_path}`);
  }

  /**
   * Starts the Express server.
   * 
   * @returns Promise that resolves with the port number
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.setup_routes();
        this.setup_queue_processor();

        // Start the server on a dynamic port
        this.server = this.app.listen(0, () => {
          const address = this.server!.address();
          const port = typeof address === 'object' && address ? address.port : 5000;
          console.log(`PKM Assistant server running at http://localhost:${port}`);

          // Write port to file for native messaging host
          this.write_port_file(port);

          resolve(port);
        });

        this.server.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stops the Express server and queue processor.
   */
  async stop(): Promise<void> {
    if (this.queue_processor) {
      this.queue_processor.stop();
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('Server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Gets the queue processor instance.
   * 
   * @returns The queue processor or undefined if not started
   */
  get_queue_processor(): VisitQueueProcessor | undefined {
    return this.queue_processor;
  }
}