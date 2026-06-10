/**
 * Provisions the re-download headless browser on a machine that has never
 * had one — a packaged install ships patchright's JS but not the browser
 * (~250 MB download, ~570 MB on disk with the headless shell), which is
 * downloaded once, on first use, into an app-owned directory and cached
 * across sessions and extension updates.
 *
 * The browsers directory is pinned through `PLAYWRIGHT_BROWSERS_PATH`, which
 * patchright's registry reads when its module loads — so this module must
 * decide the path BEFORE patchright is imported anywhere (the browser pool
 * imports patchright lazily for exactly this reason). A pre-set environment
 * variable is respected (test harnesses and power users); otherwise the
 * directory is `~/.bergamot/ms-playwright`.
 *
 * Provisioning is a single-flight operation: the first fetch that finds no
 * browser kicks off `patchright install chromium` (arch-correct for the
 * host, from Playwright's CDN — a named first-run egress in the threat
 * model) and fails fast with {@link BrowserProvisioningError}; the read path
 * keeps reporting its normal 503 "unavailable" until the install completes.
 * Extension activation is never blocked. The single-flight guard is
 * per-process: two processes provisioning the same directory concurrently
 * (extension host + headless server) are not coordinated — in practice only
 * one process runs a browser pool.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** App-owned browsers directory used when the environment does not pin one. */
export const BERGAMOT_BROWSERS_DIR = path.join(
  os.homedir(),
  ".bergamot",
  "ms-playwright"
);

/**
 * Thrown by the browser pool while the one-time Chromium download is still
 * running; the content read path maps it to its existing 503 outcome.
 */
export class BrowserProvisioningError extends Error {
  constructor() {
    super(
      "The re-download browser is being provisioned (one-time download); content is unavailable until it completes"
    );
  }
}

/** Single-flight install; resolved provision runs are not repeated. */
let provisioning: Promise<void> | null = null;

/**
 * Pins `PLAYWRIGHT_BROWSERS_PATH` for this process (no-op when already set)
 * and returns the effective browsers directory. Must run before patchright
 * is first imported.
 */
export function resolve_browsers_path(): string {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = BERGAMOT_BROWSERS_DIR;
  }
  return process.env.PLAYWRIGHT_BROWSERS_PATH;
}

/**
 * Ensures the Chromium build patchright expects exists on disk, returning
 * normally when it does. When it does not, starts (or joins) the
 * single-flight install and throws {@link BrowserProvisioningError} so the
 * caller degrades instead of waiting minutes on a fetch.
 *
 * @param executable_path - The executable patchright resolved for chromium
 *   (computed by the caller AFTER {@link resolve_browsers_path})
 * @param on_provisioning - Surfaced once per install so the host can show a
 *   progress notification; receives the install's completion promise
 */
export function ensure_browser_provisioned(
  executable_path: string,
  on_provisioning?: (done: Promise<void>) => void
): void {
  // The in-flight check comes FIRST: the installer extracts into the final
  // directory as it goes, so mid-install the executable can exist while the
  // tree is still incomplete — launching against it would fail confusingly
  // instead of with the clean provisioning signal.
  if (provisioning) {
    throw new BrowserProvisioningError();
  }
  if (fs.existsSync(executable_path)) {
    return;
  }
  provisioning = install_chromium().finally(() => {
    // Allow a retry on failure; on success the executable now exists and
    // this path is never reached again.
    provisioning = null;
  });
  // The host callback is optional (the headless server passes none); a
  // failed install must degrade to per-fetch retry, never become an
  // unhandled rejection that kills the process.
  void provisioning.catch((): undefined => undefined);
  on_provisioning?.(provisioning);
  throw new BrowserProvisioningError();
}

/**
 * Runs `patchright install chromium` (the stealth-patched build plus its
 * headless shell) into the pinned browsers directory. The CLI is resolved
 * from wherever patchright physically lives — the packaged extension's own
 * `node_modules` or the dev workspace's hoisted root.
 */
function install_chromium(): Promise<void> {
  // patchright's exports map does not expose ./cli.js as a subpath; derive it
  // from the package root via the always-exported ./package.json.
  const cli = path.join(
    path.dirname(require.resolve("patchright/package.json")),
    "cli.js"
  );
  return new Promise<void>((resolve, reject) => {
    // In the extension host process.execPath is Electron, not node;
    // ELECTRON_RUN_AS_NODE makes it behave as plain node for the child (and
    // is harmless when execPath already is node, e.g. the headless server).
    const child = spawn(process.execPath, [cli, "install", "chromium"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `patchright install chromium exited with ${code}: ${output.slice(-500)}`
          )
        );
      }
    });
  });
}
