/**
 * Resolves the staging root from the VS Code workspace (TASK-36.8). Kept SEPARATE
 * from {@link staging_writer} — which is pure `fs` and gets bundled into the
 * headless `server_standalone` — because this is the one piece that imports
 * `vscode`. Extension-host code (activation, the forget command) resolves the
 * root here and threads the resulting path into the vscode-free writer.
 */
import * as path from "path";
import * as vscode from "vscode";

export const STAGING_DIR_NAME = "bergamot.staging";

/**
 * Order: the `bergamot.staging.path` setting (absolute override, for power users
 * / sidecar mode), else `<first workspace folder>/bergamot.staging`. Returns
 * `null` when neither exists — the caller surfaces a message and writes nothing;
 * we never fall back to cwd or globalStorage (a stub the user cannot see defeats
 * the hero loop).
 */
export function resolve_staging_root(): string | null {
  const override = vscode.workspace
    .getConfiguration("bergamot")
    .get<string>("staging.path", "")
    ?.trim();
  if (override) return override;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) return path.join(folder.uri.fsPath, STAGING_DIR_NAME);
  return null;
}
