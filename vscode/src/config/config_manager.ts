import * as vscode from 'vscode';

export class ConfigManager {
  private static readonly CONFIG_NAMESPACE = 'bergamot';

  /**
   * Dev-phase observability (the Bergamot Dev channel + dev-log.jsonl) is off by
   * default so installed extensions stay quiet.
   */
  static get_dev_mode(): boolean {
    const config = vscode.workspace.getConfiguration(this.CONFIG_NAMESPACE);
    return config.get<boolean>('devMode', false);
  }

  /**
   * Cadence (in hours) for the automatic TDT clustering run. Default once/day:
   * personal browsing is low hundreds–low thousands of pages/month and a tick
   * over an unchanged window is idempotent (a no-op), so a daily tick costs
   * ~nothing on quiet days while a faster cadence buys nothing — re-download is
   * politeness-gated. `0` disables the automatic run; the scheduler clamps to a
   * sane floor.
   */
  static get_cluster_cadence_hours(): number {
    const config = vscode.workspace.getConfiguration(this.CONFIG_NAMESPACE);
    return config.get<number>('tdt.clusterCadenceHours', 24);
  }
}
