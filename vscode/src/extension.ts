import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './config/config_manager';
import { get_storage_base } from './config/storage_path';
import { resolve_staging_root } from './tdt/staging_root';
import { init_dev_log } from './dev_log';
import { DatabaseManager, METADATA_DB_FILENAME } from './database/database_manager';
import { METADATA_DB_KEY_SECRET, get_or_create_store_key } from './database/encryption_key';
import { ServerManager } from './server/server_manager';
import { MCPServerManager } from './server/mcp_server_manager';
import { CommandManager } from './commands/command_manager';
import { ClusterScheduler } from './tdt/cluster_scheduler';

let database_manager: DatabaseManager;
let server_manager: ServerManager;
let mcp_server_manager: MCPServerManager;
let command_manager: CommandManager;
let cluster_scheduler: ClusterScheduler | undefined;

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

    // The metadata store is encrypted at rest; its data-encryption key lives in
    // the OS keystore via SecretStorage and is generated on first run. Key loss
    // means the store is unrecoverable (no plaintext fallback) — see
    // docs/threat-model.md.
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

    console.log('Starting webpage categorizer service...');
    server_manager = new ServerManager({
      duck_db: databases.duck_db,
      inbox_dir: path.join(storage_base, 'visit_inbox'),
      storage_base,
      // Claim the candidate port range from any stale Bergamot server (e.g. a
      // debug host that outlived its window) so this instance is the single
      // server the browser reaches. Only the real activation does this.
      reclaim_port: true,
      // Source of the content cache's encryption key; enables default-path
      // caching of re-downloaded public content under the "default" scope.
      secrets: context.secrets,
      // Quarantined staging root for note-stub write-back (TASK-36.8), resolved
      // from the workspace; undefined when no workspace is open.
      staging_root: resolve_staging_root() ?? undefined,
      // Install root, used to locate the compiled off-thread clustering worker
      // (out/tdt/cluster_worker.js) the TDT run forks (TASK-36.9).
      extension_path: context.extensionPath,
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

    console.log('Registering extension commands...');
    command_manager = new CommandManager({
      context,
      duck_db: databases.duck_db,
      server_manager,
      storage_base
    });
    command_manager.register_all();

    console.log('Scheduling MCP server startup...');
    mcp_server_manager = new MCPServerManager({ context });
    mcp_server_manager.start_deferred(2000);

    // The passive-product path: a catch-up tick runs shortly after activation,
    // then on the configured cadence (default daily); quiet-day ticks are no-ops
    // via §8 idempotency. A run failure is logged but never disrupts capture.
    cluster_scheduler = new ClusterScheduler({
      run: (spec) => server_manager.rebuild_clusters(spec),
      cadence_hours: () => ConfigManager.get_cluster_cadence_hours(),
      now: () => new Date(),
      on_error: (error) =>
        console.error('TDT scheduled clustering run failed:', error),
    });
    cluster_scheduler.start();

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

export async function deactivate(): Promise<void> {
  console.log('Deactivating Bergamot extension...');

  try {
    // Stop the clustering scheduler before the DB closes so no tick fires into
    // a torn-down writer.
    if (cluster_scheduler) {
      cluster_scheduler.dispose();
      cluster_scheduler = undefined;
      console.log('Cluster scheduler disposed');
    }

    if (server_manager) {
      await server_manager.stop();
      console.log('Express server stopped');
    }

    if (mcp_server_manager) {
      await mcp_server_manager.stop();
      console.log('MCP server stopped');
    }

    if (database_manager) {
      await database_manager.close_all();
      console.log('Databases closed');
    }

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