import * as vscode from 'vscode';

/**
 * Configuration manager for the PKM Assistant extension.
 * Handles retrieval and validation of extension settings.
 */
export class ConfigManager {
  private static readonly CONFIG_NAMESPACE = 'pkm-assistant';
  
  /**
   * Retrieves and validates the OpenAI API key from VS Code settings.
   * Shows an error message if the key is not configured.
   * 
   * @returns The API key if configured, undefined otherwise
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
   * Retrieves the agent memory configuration.
   * 
   * @returns Object containing memory configuration settings
   */
  static get_memory_config(): { enabled: boolean } {
    const config = vscode.workspace.getConfiguration(`${this.CONFIG_NAMESPACE}.agentMemory`);
    return {
      enabled: config.get<boolean>('enabled', true)
    };
  }

  /**
   * Gets the path for the markdown database.
   * TODO: Make this configurable through settings.
   * 
   * @returns Path to the markdown database file
   */
  static get_markdown_db_path(): string {
    // TODO: make this path configurable
    return '/Users/chuck/workspace/pkm/webpages_db.md';
  }

  /**
   * Gets the path for the DuckDB database file.
   * 
   * @param storage_path - Base storage path from extension context
   * @returns Full path to the DuckDB database file
   */
  static get_duck_db_path(storage_path: string): string {
    return `${storage_path}/webpage_categorizations.db`;
  }
}