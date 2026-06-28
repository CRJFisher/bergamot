import * as path from "path";
import { resolve_staging_root } from "./staging_root";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vscode = require("vscode");

describe("resolve_staging_root", () => {
  afterEach(() => {
    vscode.workspace.workspaceFolders = undefined;
    vscode.workspace.getConfiguration.mockReturnValue({
      get: (_k: string, d?: unknown) => d,
    });
  });

  it("uses the first workspace folder when no override", () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/home/me/vault" } }];
    expect(resolve_staging_root()).toBe(
      path.join("/home/me/vault", "bergamot.staging"),
    );
  });

  it("honours the bergamot.staging.path override", () => {
    vscode.workspace.getConfiguration.mockReturnValue({
      get: (_k: string, _d?: unknown) => "/custom/staging",
    });
    expect(resolve_staging_root()).toBe("/custom/staging");
  });

  it("prefers the override over an existing workspace folder", () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/home/me/vault" } }];
    vscode.workspace.getConfiguration.mockReturnValue({
      get: (_k: string, _d?: unknown) => "/custom/staging",
    });
    expect(resolve_staging_root()).toBe("/custom/staging");
  });

  it("ignores a whitespace-only override and falls back to the workspace folder", () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/home/me/vault" } }];
    vscode.workspace.getConfiguration.mockReturnValue({
      get: (_k: string, _d?: unknown) => "   ",
    });
    expect(resolve_staging_root()).toBe(
      path.join("/home/me/vault", "bergamot.staging"),
    );
  });

  it("returns null when neither override nor workspace exists", () => {
    vscode.workspace.workspaceFolders = undefined;
    expect(resolve_staging_root()).toBeNull();
  });
});
