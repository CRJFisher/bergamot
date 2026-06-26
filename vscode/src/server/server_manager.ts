import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from 'http';
import { md5_hash } from '../hash_utils';
import {
  DuckDB,
  get_webpage_by_url,
  get_page_by_title,
  get_page_sessions_with_tree_id,
  get_last_modified_trees_with_members,
} from '../duck_db';
import { getDomain } from 'tldts';
import {
  list_clusters_in_range,
  get_cluster,
  list_clusters_for_page,
  window_coverage,
  get_cluster_anchor,
} from '../tdt/cluster_reads';
import { ClusterControlStore } from '../tdt/cluster_control_store';
import { stage_note_stub } from '../tdt/staging_writer';
import { OrphanedVisitsManager } from '../orphaned_visits';
import { VisitQueueProcessor, ExtendedPageVisit } from '../visit_queue_processor';
import { ensure_inbox, persist_visit } from '../visit_inbox';
import { PageActivitySessionWithoutTreeSchema } from '../duck_db_models';
import { dev_log, is_dev_log_enabled, is_browser_dev_stage, format_error_detail } from '../dev_log';
import { persist_replay_visit } from '../visit_replay';
import { BrowserPool } from '../redownload/browser_pool';
import { PolitenessGate } from '../redownload/politeness_gate';
import { HeadlessFetcher, Fetcher } from '../redownload/headless_fetcher';
import { ReDownloadCorpus, ContentCorpus } from '../redownload/corpus';
import { CachedCorpus } from '../redownload/cached_corpus';
// Type-only: the value side of content_cache.ts imports `vscode`, which the
// headless standalone (bundled, no extension host) cannot require. The runtime
// open is a lazy dynamic import inside init_default_content_cache.
import type * as vscode from 'vscode';
import type { ContentCache } from '../redownload/content_cache';
// Type-only: the value side (the embed pass + native onnxruntime embedder) is
// lazily imported inside run_one_embed_pass so it never loads eagerly.
import type { EmbedPassReport } from '../tdt/embed_pass';
import { single_flight, SingleFlightHolder } from '../tdt/single_flight';

/**
 * Candidate ports the server tries to bind, in order. The browser extension
 * probes this same range to discover the running server (see the extension's
 * `server_discovery` module — the range must stay in sync across both sides).
 */
export const SERVER_PORT_RANGE: readonly number[] = [
  5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009,
];

/** The `/status` service marker that identifies a Bergamot capture server. */
const SERVICE_MARKER = 'bergamot';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns true if `base_url` is a running Bergamot capture server (its `/status`
 * reports the expected service marker). Mirrors the browser extension's probe.
 */
const is_bergamot_server = async (base_url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${base_url}/status`, { method: 'GET' });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: string };
    return body.service === SERVICE_MARKER;
  } catch {
    // Connection refused / nothing listening / non-JSON — not our server.
    return false;
  }
};

/** Polls until `base_url` stops responding as a Bergamot server, or times out. */
const wait_for_port_release = async (base_url: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await is_bergamot_server(base_url))) return;
    await delay(100);
  }
};

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
   * When true, {@link ServerManager.start} shuts down any other Bergamot capture
   * server in the candidate range before binding, so this instance becomes the
   * single server the browser reaches (see {@link ServerManager.evict_stale_servers}).
   * Off by default: this is a destructive cross-process action, enabled only by
   * the real extension activation — never in tests or the headless harness, where
   * it would shut down a developer's live server or a sibling jest worker.
   */
  reclaim_port?: boolean;
  /**
   * VS Code SecretStorage, source of the content cache's encryption key. When
   * set together with {@link storage_base} and no injected {@link content_corpus},
   * the default read path persists every ok re-download into the encrypted
   * content cache under the `"default"` scope. Absent (the headless standalone,
   * tests) the read path stays live-only and caches nothing.
   */
  secrets?: vscode.SecretStorage;
  /**
   * Content read path backing `/query/capture_content`. Defaults to a stealth
   * headless re-download corpus over the stored URLs; injectable for tests.
   * An injected corpus bypasses the default-path content cache entirely.
   */
  content_corpus?: ContentCorpus;
  /**
   * Fetcher backing the default re-download corpus. Defaults to a stealth
   * headless browser fetcher; injectable so tests can drive the cached read
   * path without launching Chromium. Ignored when {@link content_corpus} is set.
   */
  fetcher?: Fetcher;
  /**
   * Surfaced once when the re-download browser's one-time download starts
   * (packaged installs ship no Chromium); the host shows a progress
   * notification. Until it completes the read path serves 503 "unavailable".
   */
  on_browser_provisioning?: (done: Promise<void>) => void;
  /**
   * Quarantined `bergamot.staging/` root for note-stub write-back (TASK-36.8),
   * resolved from the VS Code workspace at activation (see {@link resolve_staging_root}).
   * The `POST /stage_cluster` route writes promotable stubs here. Absent (the
   * headless standalone, or no workspace open) the route reports staging
   * unavailable rather than writing somewhere the user cannot see.
   */
  staging_root?: string;
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
  /** The unwrapped live (or injected) read path. */
  private readonly base_corpus: ContentCorpus;
  // The active read path: base_corpus, or a CachedCorpus over it once default-
  // path caching is enabled. Route handlers read it per-request, so the swap
  // (and its reversal on teardown) is safe.
  private content_corpus: ContentCorpus;
  /** Set only when this manager owns the default re-download browser. */
  private browser_pool?: BrowserPool;
  /**
   * The encrypted content cache, owned for the server's lifetime and exposed via
   * {@link get_content_cache} so the right-to-forget cascade reuses this single
   * DuckDB handle (one instance may attach the file at a time).
   */
  private content_cache?: ContentCache;
  /**
   * Single-flight latch for the TDT embed pass: coalesces concurrent triggers
   * (a re-invoked command, or a future clustering run that calls
   * {@link embed_pages} before reading vectors) onto one pass — so the ~34 MB
   * model is loaded once and two passes never race writes to the same
   * `topic_page_vector` key.
   */
  private readonly embed_pass_flight: SingleFlightHolder<EmbedPassReport> = {};

  constructor(private config: ServerConfig) {
    this.app = express();
    this.base_corpus = config.content_corpus ?? this.build_redownload_corpus();
    this.content_corpus = this.base_corpus;
    this.setup_middleware();
  }

  /**
   * Builds the default content read path: a stealth headless re-download corpus.
   * The browser launches lazily on the first content request and is closed on
   * {@link stop}. An injected fetcher (tests) drives the corpus without a browser.
   */
  private build_redownload_corpus(): ContentCorpus {
    if (this.config.fetcher) {
      return new ReDownloadCorpus(this.config.duck_db, this.config.fetcher);
    }
    this.browser_pool = new BrowserPool({
      on_browser_provisioning: this.config.on_browser_provisioning,
    });
    const fetcher = new HeadlessFetcher(this.browser_pool, new PolitenessGate());
    return new ReDownloadCorpus(this.config.duck_db, fetcher);
  }

  /**
   * Opens the encrypted content cache and wraps the default read path so every
   * ok re-download persists under the `"default"` scope. A no-op when a corpus
   * is injected (tests), the cache prerequisites are absent (the headless
   * standalone has no SecretStorage), or caching is already enabled. Cache-open
   * failure degrades to the uncached live corpus rather than failing the capture
   * server — the cache is a derived tier, and a degrade can never re-key anything.
   */
  private async enable_default_path_caching(): Promise<void> {
    if (this.config.content_corpus) return;
    if (!this.config.secrets || !this.config.storage_base) return;
    if (this.content_cache) return;
    try {
      // Lazy import: content_cache.ts pulls in `vscode`, absent in the bundled
      // standalone. This path only runs in the extension host (secrets set).
      const { open_content_cache } = await import('../redownload/content_cache');
      this.content_cache = await open_content_cache(
        this.config.secrets,
        this.config.storage_base
      );
      this.content_corpus = new CachedCorpus(
        this.config.duck_db,
        this.base_corpus,
        this.content_cache,
        'default'
      );
    } catch (error) {
      console.warn(
        'Bergamot: content cache unavailable; serving re-downloads live without caching.',
        format_error_detail(error)
      );
    }
  }

  /**
   * Eagerly re-downloads a freshly captured page so its public content is
   * extracted and cached before anything reads it — the push half of the
   * otherwise pull-only content path. Fire-and-forget: it runs off the capture
   * queue (never awaited), is throttled by the fetcher's politeness gate, and
   * resolves to an exclusion (nothing cached) for auth/paywall/dead pages.
   *
   * Gated on the content cache being active: without it the re-download would
   * persist nothing, so the work would be pure egress with no benefit (and the
   * headless standalone and corpus-injecting tests have no cache, so eager
   * re-download stays off there). A failure is isolated — re-download is
   * fallible by nature and must never disturb capture; the page stays
   * re-downloadable on read regardless.
   */
  private trigger_eager_redownload(page_session_id: string): void {
    if (!this.content_cache) return;
    void this.content_corpus.get_content(page_session_id).catch((error) => {
      console.warn(
        `Bergamot: eager re-download failed for ${page_session_id}:`,
        format_error_detail(error)
      );
    });
  }

  /**
   * Closes the content cache (releasing its DuckDB file lock) and restores the
   * uncached read path. Used by {@link stop} and by {@link start} when no port
   * binds, so a failed start cannot leak the lock.
   */
  private async release_content_cache(): Promise<void> {
    if (this.content_cache) {
      await this.content_cache.close();
      this.content_cache = undefined;
      this.content_corpus = this.base_corpus;
    }
  }

  /**
   * Sets up Express middleware.
   * Configures JSON parsing and CORS for browser extension communication.
   * @private
   */
  private setup_middleware(): void {
    // Visits carry browsing metadata only (url, title, timestamps, session
    // graph), which is small; the cap is a defensive bound, not content sizing.
    this.app.use(express.json({ limit: '1mb' }));
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
      orphan_manager,
      {
        batch_size: 3,
        batch_timeout: 1000,
        orphan_retry_interval: 5000,
        inbox_dir: this.config.inbox_dir,
        on_captured: (page_session_id) =>
          this.trigger_eager_redownload(page_session_id),
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

    // Graceful shutdown: lets a newly-activating Bergamot host evict an older one
    // squatting on a candidate port (see evict_stale_servers), releasing the port
    // WITHOUT killing the extension-host process. Loopback-bound like every route.
    this.app.post('/shutdown', (req, res) => {
      res.json({ status: 'shutting_down' });
      // Tear down only after the reply flushes, so the evicting host sees a clean
      // response before the socket closes.
      setImmediate(() => {
        void this.stop();
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

      // The visit payload is metadata only. The page title is captured from the
      // browser tab and threaded to the capture store; it is not part of the
      // page-activity session row, so it rides alongside the parsed session.
      const title: string =
        typeof req.body.title === 'string' ? req.body.title : '';

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { title: _title, visit_id: __, ...session_body } = req.body;
      const parse_result = PageActivitySessionWithoutTreeSchema.safeParse({
        ...session_body,
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
        title
      };
      // Persist durably before acknowledging: the browser will not resend, so
      // the visit must survive an extension restart before it reaches DuckDB.
      if (this.config.inbox_dir) {
        persist_visit(this.config.inbox_dir, extended_visit);
      }
      // In dev, keep a bounded ring of visits so a page can be replayed through
      // the pipeline (bergamot.replayVisit) without re-browsing.
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

    // Content read path: serve the stored public URL's extracted main-content
    // markdown — from the encrypted content cache when previously read, else by
    // re-downloading live and caching the result under the "default" scope.
    // Authenticated/paywalled/dead/non-HTML pages report unavailable with no
    // content — the login wall is the privacy filter. Returns the discriminated
    // corpus entry, or null when no metadata row exists for the id. The MCP
    // get_webpage_content tool routes here, as does TDT/RAG via the corpus
    // interface directly.
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

    // TDT cluster surface (TASK-36.8). Four read routes over the cluster read
    // primitive (the only layer that JOINs the cluster tables); controls are
    // applied inside it. Deliberately NOT /query/topic_* and NO MCP tool cases —
    // the raw-tool surface is retired (plan §9).
    this.app.get('/query/clusters', async (req, res) => {
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? '');
      if (!from || !to) {
        res.status(400).json({ error: 'Missing from/to query parameter' });
        return;
      }
      const requested = Number(req.query.limit ?? MAX_QUERY_LIMIT);
      const limit = Math.min(
        Number.isFinite(requested) && requested > 0 ? requested : MAX_QUERY_LIMIT,
        MAX_QUERY_LIMIT
      );
      res.json(
        await list_clusters_in_range(this.config.duck_db, { from, to, limit })
      );
    });

    this.app.get('/query/cluster', async (req, res) => {
      const id = String(req.query.id ?? '');
      if (!id) {
        res.status(400).json({ error: 'Missing id query parameter' });
        return;
      }
      res.json(await get_cluster(this.config.duck_db, { id }));
    });

    this.app.get('/query/clusters_for_page', async (req, res) => {
      const page_session_id = String(req.query.page_session_id ?? '');
      if (!page_session_id) {
        res
          .status(400)
          .json({ error: 'Missing page_session_id query parameter' });
        return;
      }
      res.json(
        await list_clusters_for_page(this.config.duck_db, { page_session_id })
      );
    });

    this.app.get('/query/cluster_coverage', async (req, res) => {
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? '');
      if (!from || !to) {
        res.status(400).json({ error: 'Missing from/to query parameter' });
        return;
      }
      res.json(await window_coverage(this.config.duck_db, { from, to }));
    });

    // Cluster curation (launch-blocking, constitution §3). Writes to Bergamot's
    // OWN control tables — never the PKM — so principle 8 does not gate it. The
    // route translates the on-screen (ephemeral) cluster id into the recompute-
    // stable anchor the control store keys on.
    this.app.post('/cluster_control', async (req, res) => {
      await this.handle_cluster_control(req, res, false);
    });
    this.app.post('/cluster_control/delete', async (req, res) => {
      await this.handle_cluster_control(req, res, true);
    });

    // Stage a cluster as a promotable note stub (the hero loop's write step).
    // The skill's draft_note_stub POSTs here so idempotency / the forget sweep /
    // the ledger all live in this one writer rather than in a script.
    this.app.post('/stage_cluster', async (req, res) => {
      const id = String(req.body?.cluster_id ?? '');
      if (!id) {
        res.status(400).json({ error: 'Missing cluster_id' });
        return;
      }
      if (!this.config.staging_root) {
        res.status(503).json({
          error:
            'Staging unavailable: open a workspace or set bergamot.staging.path',
        });
        return;
      }
      const detail = await get_cluster(this.config.duck_db, { id });
      if (!detail) {
        res
          .status(409)
          .json({ error: 'Cluster no longer exists (recompute) — refresh' });
        return;
      }
      const outcome = stage_note_stub(this.config.staging_root, detail, {
        run_id: detail.cluster.run_id,
        generated_at: new Date().toISOString(),
      });
      res.json(outcome);
    });
  }

  /**
   * Apply or delete one cluster control. Suppress/rename resolve the live cluster
   * id to its stable anchor (exemplar + label signature); never-cluster-origin
   * normalizes the supplied string to a registrable domain.
   */
  private async handle_cluster_control(
    req: express.Request,
    res: express.Response,
    is_delete: boolean
  ): Promise<void> {
    const kind = String(req.body?.kind ?? '');
    const store = new ClusterControlStore(this.config.duck_db);
    const now = new Date().toISOString();

    if (kind === 'never_cluster_origin') {
      const origin = getDomain(String(req.body?.origin ?? ''));
      if (!origin) {
        res.status(400).json({ error: 'origin must be a parseable domain' });
        return;
      }
      if (is_delete) {
        await store.delete('never_cluster_origin', { origin });
      } else {
        await store.upsert(
          { kind: 'never_cluster_origin', target_origin: origin },
          now
        );
      }
      res.json({ status: is_delete ? 'deleted' : 'applied', kind, origin });
      return;
    }

    if (kind !== 'suppress' && kind !== 'rename') {
      res.status(400).json({
        error: "kind must be 'suppress', 'rename', or 'never_cluster_origin'",
      });
      return;
    }

    const cluster_id = String(req.body?.cluster_id ?? '');
    if (!cluster_id) {
      res.status(400).json({ error: 'Missing cluster_id' });
      return;
    }
    const anchor = await get_cluster_anchor(this.config.duck_db, cluster_id);
    if (!anchor) {
      res
        .status(409)
        .json({ error: 'Cluster no longer exists (recompute) — refresh' });
      return;
    }

    if (is_delete) {
      await store.delete(kind, {
        page_session_id: anchor.exemplar_page_session_id,
      });
      res.json({ status: 'deleted', kind });
      return;
    }

    if (kind === 'rename') {
      const display_label = String(req.body?.display_label ?? '').trim();
      if (!display_label) {
        res.status(400).json({ error: 'rename requires a non-empty display_label' });
        return;
      }
      await store.upsert(
        {
          kind: 'rename',
          target_page_session_id: anchor.exemplar_page_session_id,
          content_signature: anchor.content_signature,
          display_label_override: display_label,
        },
        now
      );
    } else {
      await store.upsert(
        {
          kind: 'suppress',
          target_page_session_id: anchor.exemplar_page_session_id,
          content_signature: anchor.content_signature,
        },
        now
      );
    }
    res.json({ status: 'applied', kind });
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
   * Enables default-path caching, mounts routes, and starts the queue processor
   * without binding a port. Separated from {@link start} so the pipeline can be
   * driven in-process (e.g. integration tests via supertest) without contending
   * for a port or clobbering the shared `~/.bergamot/port.json` — and so a test
   * exercises the same cached read path the running server serves.
   */
  async prepare(): Promise<void> {
    await this.enable_default_path_caching();
    this.setup_routes();
    this.setup_queue_processor();
  }

  /**
   * Shuts down any other Bergamot capture server already bound in the candidate
   * range, so this instance can claim the lowest free port — the one the browser
   * extension probes first. Without this, a leftover host (e.g. a debug host that
   * outlived its window) keeps the low port and silently receives the captures
   * meant for this instance, while this one hides on a higher port the browser
   * may never reach. Non-Bergamot processes on a port are left untouched; the
   * bind loop simply skips past them and the browser discovers the bound port.
   */
  private async evict_stale_servers(): Promise<void> {
    for (const port of SERVER_PORT_RANGE) {
      const base_url = `http://127.0.0.1:${port}`;
      if (!(await is_bergamot_server(base_url))) continue;
      console.log(`Evicting stale Bergamot server on port ${port}`);
      try {
        await fetch(`${base_url}/shutdown`, { method: 'POST' });
      } catch {
        // The server may drop the socket before replying — that is success.
      }
      await wait_for_port_release(base_url);
    }
  }

  async start(): Promise<number> {
    await this.prepare();

    // Reclaim the candidate range from any stale Bergamot server before binding,
    // so this instance becomes the single server the browser reaches. Gated:
    // only the real extension activation opts in (see ServerConfig.reclaim_port).
    if (this.config.reclaim_port) {
      await this.evict_stale_servers();
    }

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

    // No port bound: release the cache opened above so its file lock does not
    // leak — activation will not call stop() on a failed start.
    await this.release_content_cache();
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

    // Stop accepting requests before tearing down the resources their handlers
    // use, so no in-flight read lands on a closed cache or browser.
    if (this.server) {
      // Drop idle keep-alive connections so close()'s callback can fire promptly
      // instead of waiting for clients to disconnect (which can hang shutdown).
      this.server.closeAllConnections();
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          console.log('Server stopped');
          resolve();
        });
      });
      this.server = undefined;
    }

    if (this.browser_pool) {
      // Close the re-download Chromium so no headless process is leaked.
      await this.browser_pool.close();
    }

    // Release the cache's DuckDB file lock (checkpoints the WAL) so a later
    // on-demand open (e.g. the forget command after shutdown) can attach it.
    await this.release_content_cache();
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

  /**
   * The server-owned content cache handle, or null when the default path is
   * uncached (standalone, tests, or a cache-open degrade). The right-to-forget
   * cascade reuses this rather than opening its own — DuckDB attaches the cache
   * file from one instance at a time.
   */
  get_content_cache(): ContentCache | null {
    return this.content_cache ?? null;
  }

  /**
   * Runs one TDT page-vector embed pass: vectorise every re-downloadable public
   * page missing a vector under the current embedding model, reading content
   * from the cache-served corpus and writing through the single DuckDB writer.
   * This is the "vectorise ahead of TDT" step (TASK-36.3.1) — invoked by the
   * `bergamot.tdt.embedPages` command now, and by a clustering run before it
   * reads vectors later.
   *
   * Single-flight: concurrent calls coalesce onto the running pass. The embed
   * runs off the capture hot path; per-page failures are isolated inside the
   * pass, so the returned report's `failed` count is the only failure surface.
   */
  embed_pages(): Promise<EmbedPassReport> {
    return single_flight(this.embed_pass_flight, () => this.run_one_embed_pass());
  }

  /**
   * Loads the local embedder, runs the pass, and releases the model — so the
   * model is resident only while a pass runs. The embedder, the pass, the store,
   * and the config are lazily imported: the embedder pulls the native
   * onnxruntime-node binding, which the bundled headless standalone neither has
   * nor needs, so it must stay off the eager load path (mirroring the content
   * cache's lazy import).
   */
  private async run_one_embed_pass(): Promise<EmbedPassReport> {
    if (!this.config.storage_base) {
      throw new Error(
        'TDT embed pass requires a storage base for the local model cache'
      );
    }
    const model_cache_dir = path.join(this.config.storage_base, 'tdt_models');

    const { load_local_embedder } = await import('../tdt/local_embedder');
    const { run_embed_pass } = await import('../tdt/embed_pass');
    const { PageVectorStore } = await import('../tdt/page_vector_store');
    const {
      PAGE_EMBEDDING_MODEL_ID,
      PAGE_EMBEDDING_REPR,
      PAGE_EMBEDDING_CONFIG,
    } = await import('../tdt/embedding_config');

    const store = new PageVectorStore(this.config.duck_db);
    const embedder = await load_local_embedder(model_cache_dir);
    try {
      return await run_embed_pass(
        this.content_corpus,
        store,
        embedder.embed,
        PAGE_EMBEDDING_MODEL_ID,
        PAGE_EMBEDDING_REPR,
        PAGE_EMBEDDING_CONFIG
      );
    } finally {
      await embedder.dispose();
    }
  }
}
