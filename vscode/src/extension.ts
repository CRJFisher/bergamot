import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './config/config_manager';
import { get_storage_base } from './config/storage_path';
import { init_dev_log } from './dev_log';
import { DatabaseManager, METADATA_DB_FILENAME } from './database/database_manager';
import { METADATA_DB_KEY_SECRET, get_or_create_store_key } from './database/encryption_key';
import { ServerManager } from './server/server_manager';
import { MCPServerManager } from './server/mcp_server_manager';
import { CommandManager } from './commands/command_manager';

let database_manager: DatabaseManager;
let server_manager: ServerManager;
let mcp_server_manager: MCPServerManager;
let command_manager: CommandManager;

/**
 * Activates the Bergamot VS Code extension.
 *
 * Initializes all core components:
 * - Sets up DuckDB for the relational + raw-page capture store
 * - Starts the Express capture server for browser extension communication
 * - Starts MCP (Model Context Protocol) server for external tool access
 * - Registers VS Code commands and the webpage hover provider
 *
 * @param context - VS Code extension context providing access to extension resources
 * @returns Promise that resolves when activation is complete
 * @throws {Error} If required configuration is missing or initialization fails
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Starting Bergamot extension activation...');

  try {
    // Resolve the storage base once: dev runs (F5) point BERGAMOT_STORAGE_PATH
    // at a repo-local .dev-storage; installed extensions use globalStorageUri.
    const storage_base = get_storage_base(context);

    // Dev logging is on whenever explicitly enabled, or implicitly during F5
    // debugging (BERGAMOT_STORAGE_PATH set), so the loop is observable by default.
    init_dev_log(
      storage_base,
      ConfigManager.get_dev_mode() || !!process.env.BERGAMOT_STORAGE_PATH
    );

    // Step 2: Initialize databases. The metadata store is encrypted at rest;
    // its data-encryption key lives in the OS keystore via SecretStorage and
    // is generated on first run. Key loss means the store is unrecoverable
    // (no plaintext fallback) — see docs/threat-model.md.
    console.log('Initializing databases...');
    database_manager = new DatabaseManager();

    const store_file_exists = fs.existsSync(
      path.join(storage_base, METADATA_DB_FILENAME)
    );
    const encryption_key = await get_or_create_store_key(
      context.secrets,
      METADATA_DB_KEY_SECRET,
      store_file_exists
    );
    const databases = await database_manager.initialize_all(
      storage_base,
      encryption_key
    );

    // Step 3: Start Express server for webpage categorization
    console.log('Starting webpage categorizer service...');
    server_manager = new ServerManager({
      duck_db: databases.duck_db,
      inbox_dir: path.join(storage_base, 'visit_inbox'),
      storage_base,
      // One-time Chromium download on first content fetch (packaged installs
      // ship no browser). Surfaced as a progress notification; never blocks
      // activation — the fetch path serves 503 until the download completes.
      on_browser_provisioning: (done: Promise<void>): void => {
        void vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Bergamot: one-time download of the content-fetch browser (~250 MB, ~570 MB on disk)…',
          },
          async (): Promise<void> => {
            await done.catch((): void => undefined);
          }
        );
        void done.catch((error: unknown): void => {
          void vscode.window.showWarningMessage(
            `Bergamot: content-fetcher download failed — it will retry on the next fetch. ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
    });

    const port = await server_manager.start();
    console.log(`Server started on port ${port}`);

    // Step 4: Register all extension commands
    console.log('Registering extension commands...');
    command_manager = new CommandManager({
      context,
      duck_db: databases.duck_db,
      server_manager,
      storage_base
    });
    command_manager.register_all();

    // Step 5: Start MCP server in background (deferred)
    console.log('Scheduling MCP server startup...');
    mcp_server_manager = new MCPServerManager({ context });
    mcp_server_manager.start_deferred(2000);

    // Register cleanup handlers
    context.subscriptions.push({
      dispose: async () => {
        await deactivate();
      }
    });

    console.log('Bergamot extension activated successfully!');
    console.log('MCP server will start in background after 2 seconds');

  } catch (error) {
    console.error('Failed to activate Bergamot extension:', error);
    vscode.window.showErrorMessage(
      `Bergamot activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    throw error;
  }
}

/**
 * Deactivates the Bergamot extension.
 * Performs cleanup of all resources including:
 * - Stopping the Express server
 * - Closing database connections
 * - Terminating the MCP server process
 * - Disposing of registered commands
 *
 * @returns Promise that resolves when deactivation is complete
 */
export async function deactivate(): Promise<void> {
  console.log('Deactivating Bergamot extension...');

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

    console.log('Bergamot extension deactivated successfully');
    
  } catch (error) {
    console.error('Error during deactivation:', error);
    // Don't throw during deactivation to avoid blocking VS Code shutdown
  }
}