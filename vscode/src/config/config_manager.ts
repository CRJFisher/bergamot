import * as vscode from 'vscode';

/**
 * Configuration manager for the Bergamot extension.
 * Handles retrieval of extension settings from VS Code's workspace configuration.
 *
 * @example
 * ```typescript
 * if (ConfigManager.get_dev_mode()) {
 *   // enable dev-phase observability
 * }
 * ```
 */
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
   * Cadence (in hours) for the automatic TDT clustering run (TASK-36.9). Default
   * once/day — the evidence-based judgement from TASK-36.7: personal browsing is
   * low hundreds–low thousands of pages/month, and §8 idempotency makes a tick
   * over an unchanged window a no-op, so a daily tick costs ~nothing on quiet
   * days while a faster cadence buys nothing (re-download is politeness-gated).
   * Clamped to a sane floor by the scheduler. `0` disables the automatic run.
   */
  static get_cluster_cadence_hours(): number {
    const config = vscode.workspace.getConfiguration(this.CONFIG_NAMESPACE);
    return config.get<number>('tdt.clusterCadenceHours', 24);
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