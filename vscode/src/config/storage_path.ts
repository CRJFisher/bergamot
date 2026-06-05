import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Resolves the base directory under which all persistent stores live
 * (DuckDB `webpage_categorizations.db`, the visit inbox, and the dev log).
 *
 * During F5 debugging `BERGAMOT_STORAGE_PATH` points at a repo-local
 * `.dev-storage` directory so dev runs never pollute the real PKM store. In a
 * normally-installed extension the variable is unset and the per-extension
 * `globalStorageUri` is used.
 *
 * The directory is created if it does not exist — a custom dev path is not
 * provisioned by VS Code the way `globalStorageUri` is.
 */
export function get_storage_base(context: vscode.ExtensionContext): string {
  const base = process.env.BERGAMOT_STORAGE_PATH ?? context.globalStorageUri.fsPath;
  fs.mkdirSync(base, { recursive: true });
  return base;
}
