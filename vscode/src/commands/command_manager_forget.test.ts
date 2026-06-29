import * as vscode from "vscode";
import { CommandManager, CommandConfig } from "./command_manager";
import { DuckDB } from "../duck_db";
import { ServerManager } from "../server/server_manager";
import { ContentCache, open_content_cache_if_exists } from "../redownload/content_cache";
import { forget } from "../right_to_forget";

jest.mock("../webpage_hover_provider");
jest.mock("../right_to_forget", () => ({
  forget: jest.fn().mockResolvedValue({
    page_session_ids: 0,
    urls: 0,
    files_removed: 0,
    content_cache_swept: false,
  }),
  selector_matches: jest.fn(),
}));
jest.mock("../redownload/content_cache", () => ({
  open_content_cache_if_exists: jest.fn(),
}));
jest.mock("vscode", () => ({
  commands: { registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }) },
  window: {
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
  },
  // resolve_staging_root (threaded into forget) reads workspace config; with no
  // override and no folder it resolves to null.
  workspace: {
    getConfiguration: jest.fn(() => ({ get: (_k: string, d?: unknown) => d })),
    workspaceFolders: undefined,
  },
}));

function fake_cache(): ContentCache {
  return { close: jest.fn().mockResolvedValue(undefined) } as Partial<ContentCache> as ContentCache;
}

interface ForgetRunOptions {
  get_content_cache?: jest.Mock;
  get_queue_processor?: jest.Mock;
}

/** Registers the forget command and invokes its handler once. */
async function drive_forget_command(
  options: ForgetRunOptions = {}
): Promise<void> {
  const config: CommandConfig = {
    context: { subscriptions: [] } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext,
    duck_db: {} as DuckDB,
    server_manager: {
      get_queue_processor:
        options.get_queue_processor ?? jest.fn().mockReturnValue(undefined),
      get_content_cache:
        options.get_content_cache ?? jest.fn().mockReturnValue(null),
    } as Partial<ServerManager> as ServerManager,
    storage_base: "/tmp/does-not-matter",
  };
  const manager = new CommandManager(config);
  manager.register_all();

  const registrations = (vscode.commands.registerCommand as jest.Mock).mock.calls;
  const forget_entry = registrations.find(([id]) => String(id).includes("forget"));
  expect(forget_entry).toBeDefined();
  await forget_entry![1]();
}

/** Stubs a confirmed URL-selector forget, then drives the command. */
async function run_forget_command(get_content_cache: jest.Mock): Promise<void> {
  (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
    label: "Forget a URL",
    selector_kind: "url",
  });
  (vscode.window.showInputBox as jest.Mock).mockResolvedValue(
    "https://example.com/x"
  );
  (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Forget");
  await drive_forget_command({ get_content_cache });
}

describe("forget command confirmation flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing when the selector pick is cancelled", async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    await drive_forget_command();

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it("does not delete when the modal confirmation is declined", async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      label: "Forget a URL",
      selector_kind: "url",
    });
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(
      "https://example.com/x"
    );
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

    await drive_forget_command();

    expect(forget).not.toHaveBeenCalled();
  });

  it("purges the live queue before the cascade so forgotten rows cannot re-insert", async () => {
    const purge = jest.fn();
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      label: "Forget a URL",
      selector_kind: "url",
    });
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(
      "https://example.com/x"
    );
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Forget");

    await drive_forget_command({
      get_queue_processor: jest.fn().mockReturnValue({ purge }),
    });

    expect(purge).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalled();
  });

  it("reports nothing matched when no visits or files were removed", async () => {
    (forget as jest.Mock).mockResolvedValueOnce({
      page_session_ids: 0,
      urls: 0,
      files_removed: 0,
      content_cache_swept: false,
    });
    await run_forget_command(jest.fn().mockReturnValue(null));

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Bergamot: nothing matched — nothing forgotten."
    );
  });

  it("reports the forgotten counts with the swept-artifact summary", async () => {
    (forget as jest.Mock).mockResolvedValueOnce({
      page_session_ids: 3,
      urls: 2,
      files_removed: 1,
      content_cache_swept: true,
      page_vectors_deleted: 4,
      cluster_controls_deleted: 0,
      staged_stubs_removed: 0,
    });
    await run_forget_command(jest.fn().mockReturnValue(null));

    const message = (vscode.window.showInformationMessage as jest.Mock).mock
      .calls[0][0];
    expect(message).toContain("forgot 3 visit(s) across 2 URL(s)");
    expect(message).toContain("content cache swept");
    expect(message).toContain("4 page vector(s) removed");
    expect(message).toContain("1 buffered file(s) removed");
  });

  it("surfaces a cascade failure as an error message rather than throwing", async () => {
    (forget as jest.Mock).mockRejectedValueOnce(new Error("db locked"));
    await run_forget_command(jest.fn().mockReturnValue(null));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Bergamot: forget failed — db locked"
    );
  });
});

/**
 * DuckDB attaches the cache file from a single instance at a time, so opening a
 * second handle while the server holds one would deadlock on the file lock. The
 * command therefore reuses the server-owned handle and closes only a handle it
 * opened itself.
 */
describe("forget command cache-handle reuse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reuses the server-owned handle and never closes it", async () => {
    const server_cache = fake_cache();
    await run_forget_command(jest.fn().mockReturnValue(server_cache));

    expect(forget).toHaveBeenCalledWith(
      expect.anything(),
      server_cache,
      expect.objectContaining({ kind: "url" }),
      expect.anything()
    );
    expect(open_content_cache_if_exists).not.toHaveBeenCalled();
    expect(server_cache.close).not.toHaveBeenCalled();
  });

  it("opens and closes its own handle only when the server has none", async () => {
    const owned = fake_cache();
    (open_content_cache_if_exists as jest.Mock).mockResolvedValue(owned);
    await run_forget_command(jest.fn().mockReturnValue(null));

    expect(open_content_cache_if_exists).toHaveBeenCalled();
    expect(forget).toHaveBeenCalledWith(
      expect.anything(),
      owned,
      expect.objectContaining({ kind: "url" }),
      expect.anything()
    );
    expect(owned.close).toHaveBeenCalled();
  });
});
