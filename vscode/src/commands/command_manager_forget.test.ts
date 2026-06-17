import * as vscode from "vscode";
import { CommandManager, CommandConfig } from "./command_manager";
import { DuckDB } from "../duck_db";
import { ServerManager } from "../server/server_manager";
import { ContentCache, open_content_cache_if_exists } from "../redownload/content_cache";
import { forget } from "../right_to_forget";

/**
 * The forget command must reuse the server-owned content cache handle when the
 * server holds one — DuckDB attaches the cache file from a single instance at a
 * time, so opening a second handle while the server runs would deadlock on the
 * file lock — and must close only a handle it opened itself.
 */
jest.mock("../webpage_hover_provider");
jest.mock("../right_to_forget", () => ({
  forget: jest.fn().mockResolvedValue({
    page_session_ids: 0,
    urls: 0,
    files_removed: 0,
    dev_log_files_removed: 0,
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
}));

function fake_cache(): ContentCache {
  return { close: jest.fn().mockResolvedValue(undefined) } as Partial<ContentCache> as ContentCache;
}

/** Drives the registered forget command once for a URL selector. */
async function run_forget_command(get_content_cache: jest.Mock): Promise<void> {
  (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
    label: "Forget a URL",
    selector_kind: "url",
  });
  (vscode.window.showInputBox as jest.Mock).mockResolvedValue(
    "https://example.com/x"
  );
  (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Forget");

  const config: CommandConfig = {
    context: { subscriptions: [] } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext,
    duck_db: {} as DuckDB,
    server_manager: {
      get_queue_processor: jest.fn().mockReturnValue(undefined),
      get_content_cache,
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
