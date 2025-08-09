import * as vscode from 'vscode';
import { DuckDB } from '../duck_db';
import { MarkdownDatabase } from '../markdown_db';
import { LanceDBMemoryStore } from '../lance_db';
import { EpisodicMemoryStore } from '../memory/episodic_memory_store';
import { ProceduralMemoryStore } from '../memory/procedural_memory_store';
import { register_procedural_rule_commands } from '../memory/procedural_rule_commands';
import { register_feedback_commands } from '../memory/feedback_commands';
import { register_webpage_search_commands } from '../webpage_search_commands';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { FeedbackDocumentGenerator } from '../memory/feedback_document_generator';
import { global_filter_metrics } from '../workflow/filter_metrics';

/**
 * Configuration for command registration.
 * Contains all dependencies required to register VS Code commands.
 * 
 * @interface CommandConfig
 * @property {vscode.ExtensionContext} context - VS Code extension context for registrations
 * @property {DuckDB} duck_db - Database for structured data queries
 * @property {MarkdownDatabase} markdown_db - Database for markdown content
 * @property {LanceDBMemoryStore} memory_db - Vector database for semantic search
 * @property {EpisodicMemoryStore} [episodic_store] - Optional episodic memory for feedback
 * @property {ProceduralMemoryStore} [procedural_store] - Optional procedural memory for rules
 */
export interface CommandConfig {
  context: vscode.ExtensionContext;
  duck_db: DuckDB;
  markdown_db: MarkdownDatabase;
  memory_db: LanceDBMemoryStore;
  episodic_store?: EpisodicMemoryStore;
  procedural_store?: ProceduralMemoryStore;
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
 *   markdown_db: markdownDb,
 *   memory_db: memoryDb,
 *   episodic_store: episodicStore,
 *   procedural_store: proceduralStore
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
    this.register_memory_commands();
    this.register_filter_commands();
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
   * Registers memory-related commands if memory features are enabled.
   * Conditionally registers procedural rules and feedback commands based on available stores.
   * @private
   */
  private register_memory_commands(): void {
    // Register procedural rule commands if available
    if (this.config.procedural_store) {
      register_procedural_rule_commands(
        this.config.context, 
        this.config.procedural_store
      );
    }

    // Register feedback commands if episodic store is available
    if (this.config.episodic_store) {
      const feedback_generator = new FeedbackDocumentGenerator(
        this.config.episodic_store,
        this.config.markdown_db
      );
      register_feedback_commands(
        this.config.context,
        this.config.episodic_store,
        feedback_generator
      );
    }
  }

  /**
   * Registers filter metrics command.
   * Provides command to display webpage filtering statistics.
   * @private
   */
  private register_filter_commands(): void {
    const show_metrics_command = vscode.commands.registerCommand(
      'pkm-assistant.showFilterMetrics',
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