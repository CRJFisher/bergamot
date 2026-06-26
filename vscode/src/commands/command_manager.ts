import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DuckDB } from '../duck_db';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { ServerManager } from '../server/server_manager';
import { get_recent_outcomes, show_dev_log_channel } from '../dev_log';
import { list_replay_visits, load_replay_visit } from '../visit_replay';
import {
  ContentCache,
  open_content_cache_if_exists,
} from '../redownload/content_cache';
import { ForgetSelector, forget, selector_matches } from '../right_to_forget';
import { resolve_staging_root } from '../tdt/staging_root';

/**
 * Configuration for command registration.
 * Contains all dependencies required to register VS Code commands.
 *
 * @interface CommandConfig
 * @property {vscode.ExtensionContext} context - VS Code extension context for registrations
 * @property {DuckDB} duck_db - Database for structured data queries
 */
export interface CommandConfig {
  context: vscode.ExtensionContext;
  duck_db: DuckDB;
  /** Owns the live queue processor; used by the dev observability commands */
  server_manager: ServerManager;
  /** Resolved storage base; used to locate replay visits + the visit inbox */
  storage_base: string;
}

/**
 * Manages registration of all VS Code extension commands.
 * Centralizes command registration and lifecycle management for Bergamot.
 * 
 * @example
 * ```typescript
 * const commandManager = new CommandManager({
 *   context: extensionContext,
 *   duck_db: duckDb,
 *   server_manager,
 *   storage_base
 * });
 * 
 * // Register all commands
 * commandManager.register_all();
 * 
 * // Later, during cleanup
 * commandManager.dispose();
 * ```
 */
export class CommandManager {
  private disposables: vscode.Disposable[] = [];
  /** Reused across invocations so repeated commands don't pile up duplicate
   * channels in the Output dropdown. */
  private visit_outcomes_channel: vscode.OutputChannel | null = null;

  constructor(private config: CommandConfig) {}

  /**
   * Registers all extension commands.
   * This is the main entry point that registers all command categories.
   * 
   * @example
   * ```typescript
   * commandManager.register_all();
   * // All commands are now available in VS Code
   * ```
   */
  register_all(): void {
    this.register_core_commands();
    this.register_forget_command();
    this.register_embed_pages_command();
    this.register_dev_commands();
  }

  /**
   * Registers the TDT page-vector embed command (TASK-36.3.1): vectorise every
   * re-downloadable public page missing a current-model vector, ahead of a
   * clustering run. Manual trigger for now; a clustering run drives the same
   * pass later.
   * @private
   */
  private register_embed_pages_command(): void {
    const embed_command = vscode.commands.registerCommand(
      'bergamot.tdt.embedPages',
      () => this.run_embed_pages()
    );
    this.config.context.subscriptions.push(embed_command);
    this.disposables.push(embed_command);
  }

  /**
   * Runs one embed pass under a progress notification and reports the per-page
   * outcome. The pass is single-flight in the server manager, so re-triggering
   * while one runs joins the in-flight pass rather than starting a second.
   * @private
   */
  private async run_embed_pages(): Promise<void> {
    try {
      const report = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Bergamot: embedding pages for topic detection…',
        },
        () => this.config.server_manager.embed_pages()
      );
      vscode.window.showInformationMessage(
        `Bergamot: embedded ${report.embedded}, skipped ${report.skipped}, ` +
          `excluded ${report.excluded}, failed ${report.failed} ` +
          `(of ${report.scanned} page(s)).`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Bergamot: embed pass failed — ${message}`);
    }
  }

  /**
   * Registers the right-to-forget command (constitution principle 4): the
   * user picks a selector — URL, origin, or time range — confirms, and the
   * cascade deletes the matching metadata rows and every derived artifact.
   * @private
   */
  private register_forget_command(): void {
    const forget_command = vscode.commands.registerCommand(
      'bergamot.forget',
      () => this.run_forget()
    );
    this.config.context.subscriptions.push(forget_command);
    this.disposables.push(forget_command);
  }

  /**
   * Drives one forget: selector pick → input → modal confirmation → live
   * pipeline purge → cascade. The content cache is opened only when its
   * store file already exists — forgetting never creates a cache.
   * @private
   */
  private async run_forget(): Promise<void> {
    const selector = await this.pick_forget_selector();
    if (!selector) return;

    const what =
      selector.kind === 'url'
        ? selector.url
        : selector.kind === 'origin'
          ? `every visit on ${selector.origin}`
          : `every visit from ${selector.from} to ${selector.to}`;
    const confirmed = await vscode.window.showWarningMessage(
      `Forget ${what}? This permanently deletes the matching visits and all derived content. There is no undo.`,
      { modal: true },
      'Forget'
    );
    if (confirmed !== 'Forget') return;

    // Prefer the server-owned cache handle: DuckDB attaches the cache file from
    // one instance at a time, so opening a second one here while the server holds
    // it would deadlock on the file lock. Only when the server has none (cache
    // unavailable, or a post-shutdown forget) do we open — and close — our own.
    let owned_cache: ContentCache | null = null;
    try {
      // Purge matching visits from the live in-memory pipeline first, so a
      // queued or orphan-parked visit cannot re-insert the forgotten rows
      // right after the cascade commits.
      this.config.server_manager
        .get_queue_processor()
        ?.purge((visit) =>
          selector_matches(selector, visit.url, visit.page_loaded_at ?? null)
        );

      let content_cache = this.config.server_manager.get_content_cache();
      if (!content_cache) {
        owned_cache = await open_content_cache_if_exists(
          this.config.context.secrets,
          this.config.storage_base
        );
        content_cache = owned_cache;
      }
      const report = await forget(this.config.duck_db, content_cache, selector, {
        storage_base: this.config.storage_base,
        staging_root: resolve_staging_root() ?? undefined,
      });
      const swept = [
        report.content_cache_swept ? 'content cache swept' : null,
        report.page_vectors_deleted > 0
          ? `${report.page_vectors_deleted} page vector(s) removed`
          : null,
        report.cluster_controls_deleted > 0
          ? `${report.cluster_controls_deleted} cluster control(s) removed`
          : null,
        report.staged_stubs_removed > 0
          ? `${report.staged_stubs_removed} staged stub(s) removed`
          : null,
        report.files_removed > 0
          ? `${report.files_removed} buffered file(s) removed`
          : null,
      ].filter(Boolean);
      vscode.window.showInformationMessage(
        report.page_session_ids === 0 && report.files_removed === 0
          ? 'Bergamot: nothing matched — nothing forgotten.'
          : `Bergamot: forgot ${report.page_session_ids} visit(s) across ${report.urls} URL(s)` +
            (swept.length > 0 ? ` (${swept.join(', ')}).` : '.')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Bergamot: forget failed — ${message}`);
    } finally {
      // Close only a cache this method opened; never the server-owned handle.
      if (owned_cache) {
        await owned_cache.close();
      }
    }
  }

  /**
   * Collects the forget selector from the user.
   * @private
   */
  private async pick_forget_selector(): Promise<ForgetSelector | undefined> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Forget a URL', selector_kind: 'url' as const },
        { label: 'Forget an origin (every page on a site)', selector_kind: 'origin' as const },
        { label: 'Forget a time range', selector_kind: 'time_range' as const },
      ],
      { placeHolder: 'What should Bergamot forget?' }
    );
    if (!pick) return undefined;

    if (pick.selector_kind === 'url') {
      const url = await vscode.window.showInputBox({
        prompt: 'Exact URL to forget',
        placeHolder: 'https://example.com/page',
      });
      return url ? { kind: 'url', url } : undefined;
    }
    if (pick.selector_kind === 'origin') {
      const raw = await vscode.window.showInputBox({
        prompt: 'Origin to forget (scheme + host)',
        placeHolder: 'https://example.com',
      });
      if (!raw) return undefined;
      try {
        return { kind: 'origin', origin: new URL(raw).origin };
      } catch {
        vscode.window.showErrorMessage(`Bergamot: not a valid origin: ${raw}`);
        return undefined;
      }
    }
    const from = await this.pick_timestamp(
      'Forget visits from (ISO timestamp, inclusive)',
      '2026-06-01T00:00:00Z'
    );
    if (!from) return undefined;
    const to = await this.pick_timestamp(
      'Forget visits to (ISO timestamp, inclusive)',
      '2026-06-08T00:00:00Z'
    );
    if (!to) return undefined;
    return { kind: 'time_range', from, to };
  }

  /**
   * Collects and validates one timestamp. A typo must not silently become a
   * window that matches nothing — this is a deletion primitive.
   * @private
   */
  private async pick_timestamp(
    prompt: string,
    place_holder: string
  ): Promise<string | undefined> {
    const raw = await vscode.window.showInputBox({
      prompt,
      placeHolder: place_holder,
      validateInput: (value) =>
        Number.isNaN(Date.parse(value))
          ? 'Not a parseable timestamp (use ISO-8601, e.g. 2026-06-01T00:00:00Z)'
          : null,
    });
    if (!raw) return undefined;
    return new Date(raw).toISOString();
  }

  /**
   * Registers dev-phase observability commands: a recent-visit-outcomes view
   * (why each visit dropped, plus live queue/inbox/orphan counts) and a replay
   * command that re-runs a persisted visit through the capture pipeline.
   * @private
   */
  private register_dev_commands(): void {
    const show_outcomes = vscode.commands.registerCommand(
      'bergamot.showVisitOutcomes',
      () => this.show_visit_outcomes()
    );
    const replay = vscode.commands.registerCommand(
      'bergamot.replayVisit',
      () => this.replay_visit()
    );
    this.config.context.subscriptions.push(show_outcomes, replay);
    this.disposables.push(show_outcomes, replay);
  }

  /**
   * Renders a point-in-time snapshot of recent per-visit outcomes plus live
   * pipeline counts to the "Bergamot Visit Outcomes" output channel, then
   * reveals the live "Bergamot Dev Log" channel.
   * @private
   */
  private show_visit_outcomes(): void {
    const stats = this.config.server_manager.get_queue_processor()?.get_stats();
    const inbox_count = this.count_inbox();
    const outcomes = get_recent_outcomes();

    const lines: string[] = [];
    lines.push('=== Bergamot Pipeline ===');
    lines.push(`Queue length: ${stats?.queue_length ?? 0}`);
    lines.push(`Processing: ${stats?.is_processing ?? false}`);
    lines.push(`Inbox (unprocessed): ${inbox_count}`);
    lines.push(`Orphans: ${stats?.orphan_stats.total_orphans ?? 0}`);
    lines.push('');
    lines.push(`=== Recent Visit Outcomes (${outcomes.length}) ===`);
    for (const o of outcomes) {
      const detail = [
        o.reason && `reason=${o.reason}`,
        o.error && `error=${o.error}`,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`[${o.decision}] ${o.url} (${o.visit_id}) ${detail}`.trimEnd());
    }

    if (!this.visit_outcomes_channel) {
      this.visit_outcomes_channel = vscode.window.createOutputChannel(
        'Bergamot Visit Outcomes'
      );
      this.disposables.push(this.visit_outcomes_channel);
    }
    this.visit_outcomes_channel.clear();
    this.visit_outcomes_channel.appendLine(lines.join('\n'));
    this.visit_outcomes_channel.show(true);
    show_dev_log_channel();
  }

  /**
   * Counts unprocessed visits remaining in the durable inbox.
   * @private
   */
  private count_inbox(): number {
    const inbox = path.join(this.config.storage_base, 'visit_inbox');
    if (!fs.existsSync(inbox)) return 0;
    return fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).length;
  }

  /**
   * Lets the developer pick a persisted visit and re-injects it into the queue,
   * re-running the capture pipeline without re-browsing the page.
   * @private
   */
  private async replay_visit(): Promise<void> {
    const replay_visits = list_replay_visits(this.config.storage_base);
    if (replay_visits.length === 0) {
      vscode.window.showInformationMessage('Bergamot: no visits to replay.');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      replay_visits.map((c) => ({
        label: c.url,
        description: `${c.visit_id} · ${c.page_loaded_at}`,
        visit_id: c.visit_id,
      })),
      { placeHolder: 'Select a visit to replay through the pipeline' }
    );
    if (!pick) return;

    const visit = load_replay_visit(this.config.storage_base, pick.visit_id);
    if (!visit) {
      vscode.window.showWarningMessage('Bergamot: visit was evicted before replay.');
      return;
    }

    const processor = this.config.server_manager.get_queue_processor();
    if (!processor) {
      vscode.window.showWarningMessage('Bergamot: server not running; cannot replay.');
      return;
    }
    processor.enqueue(visit);
    vscode.window.showInformationMessage(`Bergamot: replaying ${visit.url}`);
  }

  /**
   * Registers core extension commands (the webpage hover provider).
   * @private
   */
  private register_core_commands(): void {
    // Hover over a webpage link shows its captured metadata (title / visited).
    // Semantic search over page content is deferred to the RAG-prep pipeline
    // (task-31), so no LanceDB-backed search command is registered.
    register_webpage_hover_provider(this.config.context, this.config.duck_db);
  }

  /**
   * Disposes all registered commands.
   * Should be called during extension deactivation for proper cleanup.
   * 
   * @example
   * ```typescript
   * // In deactivate function
   * commandManager.dispose();
   * ```
   */
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}