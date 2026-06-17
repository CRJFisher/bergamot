import * as child_process from "child_process";
import * as vscode from "vscode";

const LINUX_KEYRING_WARNING_DISMISSED_KEY =
  "bergamot.linux_keyring_warning_dismissed";
const DBUS_PROBE_TIMEOUT_MS = 1500;

export type KeyringStatus = "available" | "degraded";

/**
 * Probes the Secret Service (org.freedesktop.secrets) over the session D-Bus
 * to detect whether a real OS keyring backs SecretStorage on this Linux session.
 *
 * Returns "available" immediately on non-Linux platforms (macOS Keychain and
 * Windows DPAPI are unconditionally present). On Linux, spawns dbus-send with
 * a Peer.Ping to org.freedesktop.secrets: exit 0 means a service owns the
 * secrets name; anything else (ENOENT, timeout, non-zero exit) means the
 * keyring is absent and safeStorage falls back to a hardcoded wrapping key.
 *
 * The returned Promise never rejects — every failure mode resolves to
 * "degraded" so the caller cannot abort activation via this probe.
 */
export function linux_keyring_status(): Promise<KeyringStatus> {
  if (process.platform !== "linux") {
    return Promise.resolve("available");
  }

  return new Promise<KeyringStatus>((resolve) => {
    let settled = false;
    const settle = (status: KeyringStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };

    let child: child_process.ChildProcess;
    try {
      child = child_process.spawn(
        "dbus-send",
        [
          "--session",
          "--dest=org.freedesktop.secrets",
          "--type=method_call",
          "--print-reply",
          "/org/freedesktop/secrets",
          "org.freedesktop.DBus.Peer.Ping",
        ],
        // stdio: ignore — we only need the exit code, not the reply body.
        // The env is intentionally inherited so DBUS_SESSION_BUS_ADDRESS
        // reaches dbus-send when a keyring is present (omitting env would
        // force a false "degraded" on machines with a working keyring).
        { stdio: "ignore" }
      );
    } catch {
      // Synchronous throw from spawn — e.g. malformed options or resource
      // exhaustion. ENOENT for a missing binary is asynchronous via 'error'
      // below; this path handles the rarer synchronous failure modes.
      resolve("degraded");
      return;
    }

    // Attached synchronously before any yield; an unhandled 'error' on a
    // ChildProcess throws as an uncaught exception. ENOENT (no dbus-send)
    // arrives here, not on 'close'.
    child.on("error", () => settle("degraded"));

    child.on("close", (code) => settle(code === 0 ? "available" : "degraded"));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle("degraded");
    }, DBUS_PROBE_TIMEOUT_MS);
  });
}

/**
 * Shows a one-time dismissible warning when the Linux keyring probe detects
 * that SecretStorage has degraded to obfuscation-only at-rest protection.
 *
 * The function is fire-and-forget at the call site (void): it never blocks
 * activation and catches its own errors so a UI or storage failure cannot
 * produce an unhandled rejection.
 */
export async function maybe_warn_linux_keyring(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    if (context.globalState.get<boolean>(LINUX_KEYRING_WARNING_DISMISSED_KEY)) {
      return;
    }

    if ((await linux_keyring_status()) === "available") {
      return;
    }

    const learn_more = "Learn more";
    const dismiss = "Dismiss";
    const choice = await vscode.window.showWarningMessage(
      "Bergamot: no OS keyring detected on this Linux session — " +
        "the encryption keys for your local stores fall back to " +
        "obfuscation-only at-rest protection. " +
        "See the threat model for details.",
      learn_more,
      dismiss
    );

    if (choice === dismiss) {
      await context.globalState.update(LINUX_KEYRING_WARNING_DISMISSED_KEY, true);
    } else if (choice === learn_more) {
      // docs/threat-model.md lives one level above the extension dir in the
      // monorepo (extensionUri = bergamot/vscode, docs at bergamot/docs), so
      // this resolves correctly in dev. In a packaged install the file is not
      // bundled, so executeCommand will throw — don't persist dismissal then:
      // the warning re-appears next activation so the user can still reach the
      // threat model from a dev workspace, or silence it via "Dismiss".
      const doc_uri = vscode.Uri.joinPath(
        context.extensionUri,
        "..",
        "docs",
        "threat-model.md"
      );
      try {
        await vscode.commands.executeCommand("markdown.showPreview", doc_uri);
        await context.globalState.update(LINUX_KEYRING_WARNING_DISMISSED_KEY, true);
      } catch {
        // Preview failed; leave dismissed flag unset so the warning recurs.
      }
    }
    // Closing via X (choice === undefined) intentionally does not persist the
    // flag — the warning re-appears next activation on a still-degraded machine.
  } catch (err) {
    console.error("Bergamot: keyring degradation check failed:", err);
  }
}
