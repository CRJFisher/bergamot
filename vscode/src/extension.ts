import * as vscode from 'vscode';
import { ConfigManager } from './config/config_manager';
import { DatabaseManager } from './database/database_manager';
import { ServerManager } from './server/server_manager';
import { MCPServerManager } from './server/mcp_server_manager';
import { CommandManager } from './commands/command_manager';
import { BrowserIntegrationSetup, register_browser_integration_commands } from './browser_integration/setup_orchestrator';

let database_manager: DatabaseManager;
let server_manager: ServerManager;
let mcp_server_manager: MCPServerManager;
let command_manager: CommandManager;

/**
 * Activates the PKM Assistant VS Code extension.
 *
 * Initializes all core components:
 * - Configures OpenAI API integration for AI-powered analysis
 * - Sets up DuckDB for structured webpage data storage
 * - Starts Express server for browser extension communication
 * - Initializes LanceDB memory store for content and embeddings
 * - Configures episodic and procedural memory systems
 * - Starts MCP (Model Context Protocol) server for external tool access
 * - Registers VS Code commands and providers for search and hover functionality
 *
 * @param context - VS Code extension context providing access to extension resources
 * @returns Promise that resolves when activation is complete
 * @throws {Error} If required configuration is missing or initialization fails
 *
 * @example
 * ```typescript
 * // This function is automatically called by VS Code when the extension activates
 * // Users need to configure the OpenAI API key in VS Code settings:
 * // "mindsteep.openaiApiKey": "your-openai-key"
 * ```
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Starting PKM Assistant extension activation...');

  try {
    // Step 1: Validate configuration
    const openai_api_key = ConfigManager.get_openai_api_key();
    if (!openai_api_key) {
      console.error('Activation aborted: Missing OpenAI API key');
      return;
    }

    // Step 2: Initialize databases
    console.log('Initializing databases...');
    database_manager = new DatabaseManager();
    const memory_config = ConfigManager.get_memory_config();
    const markdown_path = ConfigManager.get_markdown_db_path();
    
    const databases = await database_manager.initialize_all(
      context,
      openai_api_key,
      markdown_path,
      memory_config.enabled
    );

    // Step 3: Start Express server for webpage categorization
    console.log('Starting webpage categorizer service...');
    server_manager = new ServerManager({
      openai_api_key,
      duck_db: databases.duck_db,
      markdown_db: databases.markdown_db,
      memory_db: databases.memory_db,
      episodic_store: databases.episodic_store,
      procedural_store: databases.procedural_store
    });
    
    const port = await server_manager.start();
    console.log(`Server started on port ${port}`);

    // Step 4: Register all extension commands
    console.log('Registering extension commands...');
    command_manager = new CommandManager({
      context,
      duck_db: databases.duck_db,
      markdown_db: databases.markdown_db,
      memory_db: databases.memory_db,
      episodic_store: databases.episodic_store,
      procedural_store: databases.procedural_store
    });
    command_manager.register_all();

    // Step 5: Register browser integration commands
    console.log('Registering browser integration commands...');
    register_browser_integration_commands(context);

    // Step 6: Start MCP server in background (deferred)
    console.log('Scheduling MCP server startup...');
    mcp_server_manager = new MCPServerManager({
      context,
      openai_api_key,
      duck_db: databases.duck_db
    });
    mcp_server_manager.start_deferred(2000);

    // Register cleanup handlers
    context.subscriptions.push({
      dispose: async () => {
        await deactivate();
      }
    });

    console.log('PKM Assistant extension activated successfully!');
    console.log('MCP server will start in background after 2 seconds');
    
    // Step 7: Check for browser integration setup (after successful activation)
    const browser_setup = new BrowserIntegrationSetup(context);
    if (await browser_setup.should_prompt_setup()) {
      console.log('Prompting for browser integration setup...');
      await browser_setup.record_prompt();
      
      // Delay the prompt slightly to avoid overwhelming the user
      setTimeout(async () => {
        await browser_setup.run_setup();
      }, 3000);
    }
    
  } catch (error) {
    console.error('Failed to activate PKM Assistant extension:', error);
    vscode.window.showErrorMessage(
      `PKM Assistant activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    throw error;
  }
}

/**
 * Deactivates the PKM Assistant extension.
 * Performs cleanup of all resources including:
 * - Stopping the Express server
 * - Closing database connections
 * - Terminating the MCP server process
 * - Disposing of registered commands
 *
 * @returns Promise that resolves when deactivation is complete
 */
export async function deactivate(): Promise<void> {
  console.log('Deactivating PKM Assistant extension...');

  try {
    // Stop servers
    if (server_manager) {
      await server_manager.stop();
      console.log('Express server stopped');
    }

    if (mcp_server_manager) {
      await mcp_server_manager.stop();
      console.log('MCP server stopped');
    }

    // Close databases
    if (database_manager) {
      await database_manager.close_all();
      console.log('Databases closed');
    }

    // Dispose commands
    if (command_manager) {
      command_manager.dispose();
      console.log('Commands disposed');
    }

    console.log('PKM Assistant extension deactivated successfully');
    
  } catch (error) {
    console.error('Error during deactivation:', error);
    // Don't throw during deactivation to avoid blocking VS Code shutdown
  }
}