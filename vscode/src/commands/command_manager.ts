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
 */
export class CommandManager {
  private disposables: vscode.Disposable[] = [];

  constructor(private config: CommandConfig) {}

  /**
   * Registers all extension commands.
   */
  register_all(): void {
    this.register_core_commands();
    this.register_search_commands();
    this.register_memory_commands();
    this.register_filter_commands();
  }

  /**
   * Registers core extension commands.
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
   */
  private register_search_commands(): void {
    // Already handled by register_webpage_search_commands in core commands
  }

  /**
   * Registers memory-related commands if memory features are enabled.
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
   * @param value - The value
   * @param total - The total
   * @returns Percentage as string
   */
  private get_percentage(value: number, total: number): string {
    if (total === 0) return '0';
    return ((value / total) * 100).toFixed(1);
  }

  /**
   * Disposes all registered commands.
   */
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}