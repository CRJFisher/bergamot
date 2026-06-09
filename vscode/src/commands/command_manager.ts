import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DuckDB } from '../duck_db';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { ServerManager } from '../server/server_manager';
import { get_recent_outcomes, show_dev_log_channel } from '../dev_log';
import { list_replay_visits, load_replay_visit } from '../visit_replay';

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
    this.register_dev_commands();
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