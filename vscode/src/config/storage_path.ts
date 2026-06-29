import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Resolves the base directory under which all persistent stores live.
 *
 * `BERGAMOT_STORAGE_PATH` lets F5 debug runs target a repo-local
 * `.dev-storage` directory so they never pollute the real PKM store; when
 * unset the per-extension `globalStorageUri` is used.
 *
 * The directory is created eagerly because, unlike `globalStorageUri`, a
 * custom dev path is not provisioned by VS Code.
 */
export function get_storage_base(context: vscode.ExtensionContext): string {
  const base = process.env.BERGAMOT_STORAGE_PATH ?? context.globalStorageUri.fsPath;
  fs.mkdirSync(base, { recursive: true });
  return base;
}
