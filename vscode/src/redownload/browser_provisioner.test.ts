import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as child_process from "child_process";
import {
  BERGAMOT_BROWSERS_DIR,
  BrowserProvisioningError,
  ensure_browser_provisioned,
  resolve_browsers_path,
} from "./browser_provisioner";

jest.mock("child_process");

/** The shape of the fake `patchright install` child the tests drive. */
interface FakeInstallChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

/** A fake `patchright install` child the tests resolve on demand. */
function fake_install_child(): FakeInstallChild {
  const child = new EventEmitter() as FakeInstallChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("resolve_browsers_path", () => {
  const original = process.env.PLAYWRIGHT_BROWSERS_PATH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = original;
    }
  });

  it("pins the app-owned directory when the environment is unset", () => {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;

    expect(resolve_browsers_path()).toBe(BERGAMOT_BROWSERS_DIR);
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe(BERGAMOT_BROWSERS_DIR);
    expect(BERGAMOT_BROWSERS_DIR).toBe(
      path.join(os.homedir(), ".bergamot", "ms-playwright")
    );
  });

  it("respects a pre-set environment variable", () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "/custom/browsers";

    expect(resolve_browsers_path()).toBe("/custom/browsers");
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe("/custom/browsers");
  });
});

describe("ensure_browser_provisioned", () => {
  let temp_dir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-provision-"));
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  it("is a no-op when the executable exists", () => {
    const executable = path.join(temp_dir, "chromium");
    fs.writeFileSync(executable, "");

    expect(() => ensure_browser_provisioned(executable)).not.toThrow();
    expect(child_process.spawn).not.toHaveBeenCalled();
  });

  it("starts a single-flight install and fails fast while it runs", async () => {
    const child = fake_install_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    const missing = path.join(temp_dir, "missing", "chromium");
    const surfaced: Promise<void>[] = [];

    // First fetch: kicks off the install, surfaces it once, throws.
    expect(() =>
      ensure_browser_provisioned(missing, (done) => surfaced.push(done))
    ).toThrow(BrowserProvisioningError);
    // Second fetch while the install runs: still fails fast, no second spawn,
    // no second notification.
    expect(() =>
      ensure_browser_provisioned(missing, (done) => surfaced.push(done))
    ).toThrow(BrowserProvisioningError);

    expect(child_process.spawn).toHaveBeenCalledTimes(1);
    const [, args] = (child_process.spawn as jest.Mock).mock.calls[0];
    expect(args.slice(-2)).toEqual(["install", "chromium"]);
    expect(surfaced).toHaveLength(1);

    child.emit("exit", 0);
    await expect(surfaced[0]).resolves.toBeUndefined();
  });

  it("a failed install with no observer does not raise an unhandled rejection", async () => {
    // The headless server passes no on_provisioning callback; a failed
    // download must degrade to per-fetch retry, never crash the process.
    const child = fake_install_child();
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    const missing = path.join(temp_dir, "missing", "chromium");
    const unhandled = jest.fn();
    process.once("unhandledRejection", unhandled);

    expect(() => ensure_browser_provisioned(missing)).toThrow(
      BrowserProvisioningError
    );
    child.emit("exit", 1);
    await new Promise(setImmediate); // flush rejection delivery
    await new Promise(setImmediate);

    expect(unhandled).not.toHaveBeenCalled();
    process.removeListener("unhandledRejection", unhandled);
  });

  it("a failed install rejects the surfaced promise and a later call retries", async () => {
    const first_child = fake_install_child();
    const second_child = fake_install_child();
    (child_process.spawn as jest.Mock)
      .mockReturnValueOnce(first_child)
      .mockReturnValueOnce(second_child);
    const missing = path.join(temp_dir, "missing", "chromium");
    const surfaced: Promise<void>[] = [];

    expect(() =>
      ensure_browser_provisioned(missing, (done) => surfaced.push(done))
    ).toThrow(BrowserProvisioningError);
    first_child.stderr.emit("data", Buffer.from("download failed"));
    first_child.emit("exit", 1);
    await expect(surfaced[0]).rejects.toThrow(/download failed/);

    // The failure cleared the single-flight slot: the next fetch retries.
    expect(() =>
      ensure_browser_provisioned(missing, (done) => surfaced.push(done))
    ).toThrow(BrowserProvisioningError);
    expect(child_process.spawn).toHaveBeenCalledTimes(2);
    second_child.emit("exit", 0);
    await expect(surfaced[1]).resolves.toBeUndefined();
  });
});
