import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from 'http';
import { decompress } from '@mongodb-js/zstd';
import { md5_hash } from '../hash_utils';
import {
  DuckDB,
  get_webpage_by_url,
  get_page_by_title,
  get_page_sessions_with_tree_id,
  get_last_modified_trees_with_members,
} from '../duck_db';
import { OrphanedVisitsManager } from '../orphaned_visits';
import { VisitQueueProcessor, ExtendedPageVisit } from '../visit_queue_processor';
import { ensure_inbox, persist_visit } from '../visit_inbox';
import { PageActivitySessionWithoutTreeOrContentSchema } from '../duck_db_models';
import { CaptureDeps } from '../workflow/page_capture_pipeline';
import { dev_log, is_dev_log_enabled, is_browser_dev_stage, format_error_detail } from '../dev_log';
import { persist_replay_visit } from '../visit_replay';
import { BrowserPool } from '../redownload/browser_pool';
import { PolitenessGate } from '../redownload/politeness_gate';
import { HeadlessFetcher } from '../redownload/headless_fetcher';
import { ReDownloadCorpus, ContentCorpus } from '../redownload/corpus';

/**
 * Candidate ports the server tries to bind, in order. The browser extension
 * probes this same range to discover the running server (see the extension's
 * `server_discovery` module — the range must stay in sync across both sides).
 */
export const SERVER_PORT_RANGE: readonly number[] = [
  5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009,
];

/**
 * Upper bound on decompressed capture content. The browser already caps what it
 * sends; this is a defensive guard so a malformed or hostile payload cannot
 * exhaust memory when it decompresses (zstd "zip bomb").
 */
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB

/** Maximum number of rows any read-only /query endpoint will return. */
const MAX_QUERY_LIMIT = 100;

/**
 * Configuration for the server manager.
 * Contains the dependencies required to run the capture server.
 *
 * @interface ServerConfig
 * @property {DuckDB} duck_db - Relational + raw-page capture store
 */
export interface ServerConfig {
  duck_db: DuckDB;
  /** Directory for the durable visit inbox (defaults off if unset) */
  inbox_dir?: string;
  /** Storage base; used to persist raw captures for replay in dev mode */
  storage_base?: string;
  /**
   * Content read path backing `/query/capture_content`. Defaults to a stealth
   * headless re-download corpus over the stored URLs; injectable for tests.
   */
  content_corpus?: ContentCorpus;
}

/**
 * Manages the Express server for the capture pipeline. Provides HTTP endpoints
 * for the browser extension to submit webpage visits (which are gated and stored
 * by the capture pipeline) and read-only relational query endpoints.
 *
 * @example
 * ```typescript
 * const serverManager = new ServerManager({ duck_db: duckDb });
 *
 * const port = await serverManager.start();
 * console.log(`Server running on port ${port}`);
 *
 * // Later, during cleanup
 * await serverManager.stop();
 * ```
 */
export class ServerManager {
  private server?: Server;
  private queue_processor?: VisitQueueProcessor;
  private app: express.Application;
  private readonly capture_deps: CaptureDeps;
  private readonly content_corpus: ContentCorpus;
  /** Set only when this manager owns the default re-download browser. */
  private browser_pool?: BrowserPool;

  constructor(private config: ServerConfig) {
    this.app = express();
    this.capture_deps = { duck_db: config.duck_db };
    this.content_corpus = config.content_corpus ?? this.build_redownload_corpus();
    this.setup_middleware();
  }

  /**
   * Builds the default content read path: a stealth headless re-download corpus.
   * The browser launches lazily on the first content request and is closed on
   * {@link stop}.
   */
  private build_redownload_corpus(): ContentCorpus {
    this.browser_pool = new BrowserPool();
    const fetcher = new HeadlessFetcher(this.browser_pool, new PolitenessGate());
    return new ReDownloadCorpus(this.config.duck_db, fetcher);
  }

  /**
   * Sets up Express middleware.
   * Configures JSON parsing and CORS for browser extension communication.
   * @private
   */
  private setup_middleware(): void {
    // Visits carry the page's zstd-compressed HTML (base64), which exceeds the
    // default 100kb body limit on content-heavy pages.
    this.app.use(express.json({ limit: '50mb' }));
    // Only browser extensions (and origin-less local callers such as scripts or
    // tests) may reach the server. This blocks arbitrary web pages from POSTing
    // visits via fetch — the realistic threat for a loopback-bound server.
    this.app.use(
      cors({
        origin: (origin, callback) => {
          const allowed = !origin || origin.startsWith('chrome-extension://');
          callback(null, allowed);
        },
      })
    );
  }

  /**
   * Sets up the queue processor for handling visits.
   * Initializes batch processing for efficient handling of multiple webpage visits.
   * @private
   */
  private setup_queue_processor(): void {
    if (this.config.inbox_dir) {
      ensure_inbox(this.config.inbox_dir);
    }
    const orphan_manager = new OrphanedVisitsManager();
    this.queue_processor = new VisitQueueProcessor(
      this.config.duck_db,
      this.capture_deps,
      orphan_manager,
      {
        batch_size: 3,
        batch_timeout: 1000,
        orphan_retry_interval: 5000,
        inbox_dir: this.config.inbox_dir
      }
    );
    this.queue_processor.start();
  }

  /**
   * Sets up API routes.
   * Defines HTTP endpoints for health checks and webpage visit processing.
   * @private
   */
  private setup_routes(): void {
    // Health check + service-identity endpoint. The `service` marker lets the
    // browser extension probe the candidate port range and confirm it found
    // Bergamot rather than some other process bound to the same port.
    this.app.get('/status', (req, res) => {
      res.json({
        service: 'bergamot',
        status: 'running',
        version: '1.0.0',
        uptime: process.uptime(),
      });
    });

    // Browser-relayed dev signals. These capture the browser-side stages of the
    // pipeline (a page seen, a capture that failed, a compression failure) that
    // occur before a visit reaches /visit — the point where a page's CSP, a cold
    // service worker, or a content-script crash can otherwise drop it with no
    // server-side trace. A `capture_attempted` with no matching `http_received`
    // for the same visit_id is exactly the set of silently-untracked pages.
    // Validated against the known browser stages; gated by the dev-log flag.
    this.app.post('/dev_signal', (req, res) => {
      const stage = req.body?.stage;
      if (typeof stage === 'string' && is_browser_dev_stage(stage)) {
        dev_log(stage, { source: 'browser', ...(req.body?.fields ?? {}) });
      }
      res.json({ ok: true });
    });

    // Visit processing endpoint
    this.app.post('/visit', async (req, res) => {
      const id = md5_hash(`${req.body.url}:${req.body.page_loaded_at}`);
      // Correlation token: trust the browser's id if it supplied one, else fall
      // back to the deterministic content hash. Echoed back and threaded through
      // every downstream log line so a single visit is traceable end to end.
      const visit_id: string =
        typeof req.body.visit_id === 'string' && req.body.visit_id.length > 0
          ? req.body.visit_id
          : id;
      dev_log('http_received', { visit_id, url: req.body.url });

      // Decompress content if it's base64 encoded zstd compressed data
      let content = req.body.content;
      if (typeof content === 'string' && content.length > 0) {
        try {
          const compressed_data = Buffer.from(content, 'base64');
          const decompressed_data = await decompress(compressed_data);
          if (decompressed_data.length > MAX_DECOMPRESSED_BYTES) {
            // Refuse oversized payloads rather than holding them in memory and
            // capturing them; store nothing for this visit's content.
            dev_log('decompress_failed', {
              visit_id,
              url: req.body.url,
              error: `decompressed size ${decompressed_data.length} exceeds ${MAX_DECOMPRESSED_BYTES}`,
            });
            content = '';
          } else {
            content = decompressed_data.toString('utf-8');
          }
        } catch (error) {
          dev_log('decompress_failed', {
            visit_id,
            url: req.body.url,
            error: format_error_detail(error),
          });
          // Never fall through with the raw base64 string as page content — it
          // would be captured verbatim instead of the real page.
          content = '';
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { content: _, visit_id: __, ...req_body_without_content } = req.body;
      const parse_result = PageActivitySessionWithoutTreeOrContentSchema.safeParse({
        ...req_body_without_content,
        id,
      });

      if (!parse_result.success) {
        dev_log('parse_failed', {
          visit_id,
          url: req.body.url,
          issues: parse_result.error.issues,
        });
        res.status(400).json({
          error: 'Invalid payload',
          issues: parse_result.error.issues,
        });
        return;
      }

      const payload = parse_result.data;

      // Add to queue instead of processing immediately
      const extended_visit: ExtendedPageVisit = {
        ...payload,
        visit_id,
        raw_content: content
      };
      // Persist durably before acknowledging: the browser will not resend, so
      // the visit must survive an extension restart before it reaches DuckDB.
      if (this.config.inbox_dir) {
        persist_visit(this.config.inbox_dir, extended_visit);
      }
      // In dev, keep a bounded ring of raw captures so the page can be replayed
      // through the pipeline (bergamot.replayVisit) without re-browsing.
      if (this.config.storage_base && is_dev_log_enabled()) {
        persist_replay_visit(this.config.storage_base, extended_visit);
      }
      const position = this.queue_processor?.enqueue(extended_visit) ?? 0;
      dev_log('queued', { visit_id, url: payload.url, position });

      res.json({ status: 'queued', position, visit_id });
    });

    // Read-only relational query endpoints. The extension process owns the
    // DuckDB connection (DuckDB is single-writer), so other processes — the MCP
    // server, scripts — query the tracking record through these instead of
    // opening the database file directly. See backlog/docs/query-interface.md.
    this.app.get('/query/visit_by_url', async (req, res) => {
      const url = String(req.query.url ?? '');
      if (!url) {
        res.status(400).json({ error: 'Missing url query parameter' });
        return;
      }
      res.json(await get_webpage_by_url(this.config.duck_db, url));
    });

    this.app.get('/query/page_by_title', async (req, res) => {
      const title = String(req.query.title ?? '');
      if (!title) {
        res.status(400).json({ error: 'Missing title query parameter' });
        return;
      }
      res.json(await get_page_by_title(this.config.duck_db, title));
    });

    this.app.get('/query/tree', async (req, res) => {
      const tree_id = String(req.query.tree_id ?? '');
      if (!tree_id) {
        res.status(400).json({ error: 'Missing tree_id query parameter' });
        return;
      }
      res.json(
        await get_page_sessions_with_tree_id(this.config.duck_db, tree_id)
      );
    });

    this.app.get('/query/recent_trees', async (req, res) => {
      const requested = Number(req.query.limit ?? 5);
      const limit = Math.min(
        Number.isFinite(requested) && requested > 0 ? requested : 5,
        MAX_QUERY_LIMIT
      );
      res.json(
        await get_last_modified_trees_with_members(
          this.config.duck_db,
          '',
          limit
        )
      );
    });

    // Content read path: re-download the stored public URL on demand and serve
    // its content. Authenticated/paywalled/dead/non-HTML pages report unavailable
    // with no content — the login wall is the privacy filter. Returns the
    // discriminated corpus entry, or null when no metadata row exists for the id.
    // The MCP get_webpage_content tool routes here, as does TDT/RAG via the
    // corpus interface directly.
    this.app.get('/query/capture_content', async (req, res) => {
      const page_session_id = String(req.query.page_session_id ?? '');
      if (!page_session_id) {
        res
          .status(400)
          .json({ error: 'Missing page_session_id query parameter' });
        return;
      }
      try {
        const entry = await this.content_corpus.get_content(page_session_id);
        res.json(entry);
      } catch (error) {
        // Per-page exclusions are normal outcomes; reaching here means the
        // re-download infrastructure itself failed (e.g. the headless browser
        // could not launch). Report it as unavailable rather than an opaque 500.
        res.status(503).json({
          outcome: 'unavailable',
          page_session_id,
          reason: format_error_detail(error),
        });
      }
    });
  }

  /**
   * Writes the live port to a canonical file (`~/.bergamot/port.json`) so other
   * local processes and scripts can discover the running server. The browser
   * extension does NOT rely on this file (it has no filesystem access); it
   * probes {@link SERVER_PORT_RANGE} over HTTP instead.
   *
   * @param port - The port number the server bound to
   * @private
   */
  private write_port_file(port: number): void {
    const dir = path.join(os.homedir(), '.bergamot');
    fs.mkdirSync(dir, { recursive: true });
    const port_file_path = path.join(dir, 'port.json');
    fs.writeFileSync(
      port_file_path,
      JSON.stringify({ port, pid: process.pid }, null, 2)
    );
    console.log(`Port written to ${port_file_path}`);
  }

  /**
   * Attempts to bind the Express app to a single port.
   * Resolves with the {@link Server} on success; rejects on any listen error
   * (e.g. `EADDRINUSE`) so the caller can try the next candidate port.
   * @private
   */
  private listen_on(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      // Bind to loopback only — the capture server is a local-only trust
      // boundary and must not be reachable from other hosts on the network.
      const server = this.app.listen(port, '127.0.0.1');
      const on_listening = () => {
        server.removeListener('error', on_error);
        resolve(server);
      };
      const on_error = (error: Error) => {
        server.removeListener('listening', on_listening);
        reject(error);
      };
      server.once('listening', on_listening);
      server.once('error', on_error);
    });
  }

  /**
   * Starts the Express server, binding the first free port in
   * {@link SERVER_PORT_RANGE}. The browser extension discovers the chosen port
   * by probing that same range and matching the `/status` service marker.
   *
   * @returns Promise that resolves with the bound port number
   * @throws {Error} If every candidate port is in use
   * @example
   * ```typescript
   * const port = await serverManager.start();
   * console.log(`Server listening on port ${port}`);
   * ```
   */
  /**
   * Mounts routes and starts the queue processor without binding a port.
   * Separated from {@link start} so the pipeline can be driven in-process
   * (e.g. integration tests via supertest) without contending for a port or
   * clobbering the shared `~/.bergamot/port.json`.
   */
  prepare(): void {
    this.setup_routes();
    this.setup_queue_processor();
  }

  async start(): Promise<number> {
    this.prepare();

    let last_error: unknown;
    for (const port of SERVER_PORT_RANGE) {
      try {
        this.server = await this.listen_on(port);
        console.log(`Bergamot server running at http://localhost:${port}`);
        this.write_port_file(port);
        return port;
      } catch (error) {
        last_error = error;
      }
    }

    throw new Error(
      `Could not bind any port in range ${SERVER_PORT_RANGE[0]}-` +
        `${SERVER_PORT_RANGE[SERVER_PORT_RANGE.length - 1]}`,
      { cause: last_error }
    );
  }

  /**
   * Stops the Express server and queue processor.
   * Ensures graceful shutdown of all server resources.
   * 
   * @returns Promise that resolves when the server is stopped
   * @example
   * ```typescript
   * await serverManager.stop();
   * console.log('Server stopped successfully');
   * ```
   */
  async stop(): Promise<void> {
    if (this.queue_processor) {
      this.queue_processor.stop();
    }

    if (this.browser_pool) {
      // Close the re-download Chromium so no headless process is leaked.
      await this.browser_pool.close();
    }

    if (this.server) {
      // Drop idle keep-alive connections so close()'s callback can fire promptly
      // instead of waiting for clients to disconnect (which can hang shutdown).
      this.server.closeAllConnections();
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
   * Provides access to the queue processor for monitoring or direct interaction.
   * 
   * @returns The queue processor or undefined if not started
   * @example
   * ```typescript
   * const processor = serverManager.get_queue_processor();
   * if (processor) {
   *   const queueSize = processor.getQueueSize();
   *   console.log(`Queue has ${queueSize} items`);
   * }
   * ```
   */
  get_queue_processor(): VisitQueueProcessor | undefined {
    return this.queue_processor;
  }
}