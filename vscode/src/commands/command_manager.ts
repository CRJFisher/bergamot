import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DuckDB } from '../duck_db';
import { LanceDBMemoryStore } from '../lance_db';
import { register_webpage_search_commands } from '../webpage_search_commands';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { global_filter_metrics } from '../workflow/filter_metrics';
import { ServerManager } from '../server/server_manager';
import { get_recent_outcomes, show_dev_log_channel } from '../dev_log';
import { list_captures, load_capture } from '../captures';

/**
 * Configuration for command registration.
 * Contains all dependencies required to register VS Code commands.
 *
 * @interface CommandConfig
 * @property {vscode.ExtensionContext} context - VS Code extension context for registrations
 * @property {DuckDB} duck_db - Database for structured data queries
 * @property {LanceDBMemoryStore} memory_db - Vector database for semantic search
 */
export interface CommandConfig {
  context: vscode.ExtensionContext;
  duck_db: DuckDB;
  memory_db: LanceDBMemoryStore;
  /** Owns the live queue processor; used by the dev observability commands */
  server_manager: ServerManager;
  /** Resolved storage base; used to locate captures + the visit inbox */
  storage_base: string;
}

/**
 * Manages registration of all VS Code extension commands.
 * Centralizes command registration and lifecycle management for the PKM Assistant.
 * 
 * @example
 * ```typescript
 * const commandManager = new CommandManager({
 *   context: extensionContext,
 *   duck_db: duckDb,
 *   memory_db: memoryDb
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
    this.register_search_commands();
    this.register_filter_commands();
    this.register_dev_commands();
  }

  /**
   * Registers dev-phase observability commands: a recent-visit-outcomes view
   * (why each visit dropped, plus live queue/inbox/orphan counts) and a replay
   * command that re-runs a persisted capture through the pipeline.
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
   * Renders recent per-visit outcomes plus live pipeline counts to the
   * Bergamot Dev output channel.
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
        o.page_type && `type=${o.page_type}`,
        o.confidence !== undefined && `conf=${o.confidence}`,
        o.reason && `reason=${o.reason}`,
        o.error && `error=${o.error}`,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`[${o.decision}] ${o.url} (${o.visit_id}) ${detail}`.trimEnd());
    }

    const channel = vscode.window.createOutputChannel('Bergamot Visit Outcomes');
    channel.clear();
    channel.appendLine(lines.join('\n'));
    channel.show(true);
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
   * Lets the developer pick a persisted capture and re-injects it into the
   * queue, re-running the full classification/analysis pipeline without
   * re-browsing the page.
   * @private
   */
  private async replay_visit(): Promise<void> {
    const captures = list_captures(this.config.storage_base);
    if (captures.length === 0) {
      vscode.window.showInformationMessage('Bergamot: no captures to replay.');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      captures.map((c) => ({
        label: c.url,
        description: `${c.visit_id} · ${c.page_loaded_at}`,
        visit_id: c.visit_id,
      })),
      { placeHolder: 'Select a capture to replay through the pipeline' }
    );
    if (!pick) return;

    const visit = load_capture(this.config.storage_base, pick.visit_id);
    if (!visit) {
      vscode.window.showWarningMessage('Bergamot: capture was evicted before replay.');
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
   * Registers core extension commands.
   * Includes webpage search and hover provider functionality.
   * @private
   */
  private register_core_commands(): void {
    // Register webpage search and hover provider
    register_webpage_search_commands(this.config.context, this.config.memory_db);
    register_webpage_hover_provider(
      this.config.context, 
      this.config.duck_db, 
      this.config.memory_db
    );
  }

  /**
   * Registers search-related commands.
   * Currently handled by core commands registration.
   * @private
   */
  private register_search_commands(): void {
    // Already handled by register_webpage_search_commands in core commands
  }

  /**
   * Registers filter metrics command.
   * Provides command to display webpage filtering statistics.
   * @private
   */
  private register_filter_commands(): void {
    const show_metrics_command = vscode.commands.registerCommand(
      'bergamot.showFilterMetrics',
      () => this.show_filter_metrics()
    );
    
    this.config.context.subscriptions.push(show_metrics_command);
    this.disposables.push(show_metrics_command);
  }

  /**
   * Shows filter metrics in output channel.
   * Displays comprehensive statistics about webpage filtering performance.
   * @private
   */
  private show_filter_metrics(): void {
    const metrics = global_filter_metrics.get_metrics();
    const output = vscode.window.createOutputChannel('PKM Assistant Filter Metrics');
    
    output.clear();
    output.appendLine('=== Webpage Filter Metrics ===');
    output.appendLine(`Total pages analyzed: ${metrics.total_pages}`);
    output.appendLine(
      `Pages processed: ${metrics.processed_pages} (${this.get_percentage(
        metrics.processed_pages,
        metrics.total_pages
      )}%)`
    );
    output.appendLine(
      `Pages filtered: ${metrics.filtered_pages} (${this.get_percentage(
        metrics.filtered_pages,
        metrics.total_pages
      )}%)`
    );
    output.appendLine(
      `Average confidence: ${metrics.average_confidence.toFixed(2)}`
    );
    output.appendLine('');
    output.appendLine('Page types:');
    
    Object.entries(metrics.page_types)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        output.appendLine(
          `  ${type}: ${count} (${this.get_percentage(
            count,
            metrics.total_pages
          )}%)`
        );
      });
    
    output.appendLine('');
    output.appendLine('Filter reasons:');
    
    Object.entries(metrics.filter_reasons)
      .sort(([, a], [, b]) => b - a)
      .forEach(([reason, count]) => {
        output.appendLine(
          `  ${reason}: ${count} (${this.get_percentage(
            count,
            metrics.filtered_pages
          )}%)`
        );
      });
    
    output.show();
  }

  /**
   * Helper to calculate percentage.
   * 
   * @param value - The value to calculate percentage for
   * @param total - The total value (denominator)
   * @returns Percentage as string with one decimal place
   * @private
   */
  private get_percentage(value: number, total: number): string {
    if (total === 0) return '0';
    return ((value / total) * 100).toFixed(1);
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