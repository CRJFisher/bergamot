import * as vscode from 'vscode';

/**
 * Configuration manager for the Bergamot extension.
 * Handles retrieval and validation of extension settings from VS Code's workspace configuration.
 *
 * @example
 * ```typescript
 * // Get OpenAI API key
 * const apiKey = ConfigManager.get_openai_api_key();
 * if (!apiKey) {
 *   // Handle missing API key
 *   return;
 * }
 * ```
 */
/** Which backend serves classification + the other LLM calls. */
export type LlmProvider = 'claude' | 'openai' | 'vscode';

export class ConfigManager {
  private static readonly CONFIG_NAMESPACE = 'bergamot';

  /**
   * Whether dev-phase observability (the Bergamot Dev channel + dev-log.jsonl)
   * is enabled. Off by default for installed extensions.
   */
  static get_dev_mode(): boolean {
    const config = vscode.workspace.getConfiguration(this.CONFIG_NAMESPACE);
    return config.get<boolean>('devMode', false);
  }

  /**
   * The LLM provider for classification and analysis. Defaults to the Claude
   * subscription (no API tokens); `openai` uses the OpenAI key, `vscode` uses
   * the editor's language-model API.
   */
  static get_llm_provider(): LlmProvider {
    const config = vscode.workspace.getConfiguration(this.CONFIG_NAMESPACE);
    return config.get<LlmProvider>('llmProvider', 'claude');
  }

  /**
   * Retrieves and validates the OpenAI API key from VS Code settings.
   * Shows an error message if the key is not configured.
   * 
   * @returns The API key if configured, undefined otherwise
   * @example
   * ```typescript
   * const apiKey = ConfigManager.get_openai_api_key();
   * if (!apiKey) {
   *   console.error('Cannot proceed without API key');
   *   return;
   * }
   * ```
   */
  static get_openai_api_key(): string | undefined {
    const config = vscode.workspace.getConfiguration(this.CONFIG_NAMESPACE);
    const api_key = config.get<string>('openaiApiKey');
    return api_key || undefined;
  }

  /**
   * Gets the path for the DuckDB database file.
   * Constructs the full path by appending the database filename to the storage path.
   * 
   * @param storage_path - Base storage path from extension context (usually context.globalStorageUri.fsPath)
   * @returns Full path to the DuckDB database file
   * @example
   * ```typescript
   * const storagePath = context.globalStorageUri.fsPath;
   * const dbPath = ConfigManager.get_duck_db_path(storagePath);
   * // Returns: '/path/to/storage/webpage_categorizations.db'
   * ```
   */
  static get_duck_db_path(storage_path: string): string {
    return `${storage_path}/webpage_categorizations.db`;
  }
}