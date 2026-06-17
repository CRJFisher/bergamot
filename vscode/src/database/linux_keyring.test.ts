import { EventEmitter } from "events";
import * as child_process from "child_process";
import * as vscode from "vscode";
import {
  linux_keyring_status,
  maybe_warn_linux_keyring,
} from "./linux_keyring";

jest.mock("child_process");

/** Minimal fake child process: EventEmitter + a kill spy. */
function fake_dbus_child(): EventEmitter & { kill: jest.Mock } {
  const child = new EventEmitter() as EventEmitter & { kill: jest.Mock };
  child.kill = jest.fn();
  return child;
}

/** Fake ExtensionContext slice for the warning function. */
function fake_context(already_dismissed = false): vscode.ExtensionContext {
  const store = new Map<string, unknown>([
    [
      "bergamot.linux_keyring_warning_dismissed",
      already_dismissed ? true : undefined,
    ],
  ]);
  return {
    extensionUri: new (vscode.Uri as unknown as new (path: string) => vscode.Uri)(
      "/ext"
    ),
    globalState: {
      get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
      update: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      // Unused surface — satisfy the type without any-casts.
      keys: (): readonly string[] => [],
      setKeysForSync: jest.fn(),
    },
  } as unknown as vscode.ExtensionContext;
}

const original_platform = process.platform;

function set_platform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  jest.clearAllMocks();
  set_platform(original_platform);
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// linux_keyring_status
// ---------------------------------------------------------------------------

describe("linux_keyring_status", () => {
  it.each(["darwin", "win32"] as const)(
    "returns 'available' on %s without spawning",
    async (platform) => {
      set_platform(platform);
      expect(await linux_keyring_status()).toBe("available");
      expect(child_process.spawn).not.toHaveBeenCalled();
    }
  );

  it("returns 'available' when dbus-send exits 0 on Linux", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);

    const result_promise = linux_keyring_status();
    child.emit("close", 0);
    expect(await result_promise).toBe("available");

    expect(child_process.spawn).toHaveBeenCalledWith(
      "dbus-send",
      expect.arrayContaining([
        "--dest=org.freedesktop.secrets",
        "org.freedesktop.DBus.Peer.Ping",
      ]),
      expect.objectContaining({ stdio: "ignore" })
    );
  });

  it("returns 'degraded' when dbus-send exits non-zero on Linux", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);

    const result_promise = linux_keyring_status();
    child.emit("close", 1);
    expect(await result_promise).toBe("degraded");
  });

  it("returns 'degraded' when dbus-send is not installed (ENOENT)", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);

    const result_promise = linux_keyring_status();
    child.emit("error", Object.assign(new Error("spawn dbus-send ENOENT"), { code: "ENOENT" }));
    expect(await result_promise).toBe("degraded");
  });

  it("returns 'degraded' and kills the child on timeout", async () => {
    jest.useFakeTimers();
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);

    const result_promise = linux_keyring_status();
    jest.advanceTimersByTime(1500);
    expect(await result_promise).toBe("degraded");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not double-settle when a late close fires after timeout", async () => {
    jest.useFakeTimers();
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);

    const result_promise = linux_keyring_status();
    jest.advanceTimersByTime(1500);
    // Timeout settled "degraded"; a late exit-0 must not change it.
    child.emit("close", 0);
    expect(await result_promise).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// maybe_warn_linux_keyring
// ---------------------------------------------------------------------------

describe("maybe_warn_linux_keyring", () => {
  it("does nothing when the warning was already dismissed", async () => {
    const context = fake_context(true);
    await maybe_warn_linux_keyring(context);

    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it("does not warn when a working keyring is detected (no false positive)", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    const context = fake_context();

    const warn_promise = maybe_warn_linux_keyring(context);
    child.emit("close", 0);
    await warn_promise;

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(context.globalState.update).not.toHaveBeenCalled();
  });

  it("shows the warning when keyring is degraded", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    const context = fake_context();

    const warn_promise = maybe_warn_linux_keyring(context);
    child.emit("close", 1);
    await warn_promise;

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("no OS keyring detected"),
      "Learn more",
      "Dismiss"
    );
  });

  it("does not persist dismissal when 'Learn more' cannot open the threat model", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Learn more");
    (vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error("not found"));
    const context = fake_context();

    const warn_promise = maybe_warn_linux_keyring(context);
    child.emit("close", 1);
    await warn_promise;

    expect(vscode.commands.executeCommand).toHaveBeenCalled();
    expect(context.globalState.update).not.toHaveBeenCalled();
  });

  it("persists dismissal and opens the threat model on 'Learn more'", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Learn more");
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
    const context = fake_context();

    const warn_promise = maybe_warn_linux_keyring(context);
    child.emit("close", 1);
    await warn_promise;

    expect(context.globalState.update).toHaveBeenCalledWith(
      "bergamot.linux_keyring_warning_dismissed",
      true
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "markdown.showPreview",
      expect.objectContaining({ fsPath: expect.stringContaining("threat-model.md") })
    );
  });

  it("persists dismissal and does not open the threat model on 'Dismiss'", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Dismiss");
    const context = fake_context();

    const warn_promise = maybe_warn_linux_keyring(context);
    child.emit("close", 1);
    await warn_promise;

    expect(context.globalState.update).toHaveBeenCalledWith(
      "bergamot.linux_keyring_warning_dismissed",
      true
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it("does not persist dismissal when the toast is closed via X (undefined)", async () => {
    set_platform("linux");
    const child = fake_dbus_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    const context = fake_context();

    const warn_promise = maybe_warn_linux_keyring(context);
    child.emit("close", 1);
    await warn_promise;

    expect(context.globalState.update).not.toHaveBeenCalled();
  });

  it("does not warn on macOS (no false positive)", async () => {
    set_platform("darwin");
    const context = fake_context();
    await maybe_warn_linux_keyring(context);

    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
