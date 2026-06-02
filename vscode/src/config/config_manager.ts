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
export class ConfigManager {
  private static readonly CONFIG_NAMESPACE = 'bergamot';
  
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

    if (!api_key) {
      console.error('OpenAI API key is not configured');
      vscode.window.showErrorMessage(
        'OpenAI API key is not configured. Please set it in settings.'
      );
      return undefined;
    }
    
    console.log('OpenAI API key found in configuration');
    return api_key;
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