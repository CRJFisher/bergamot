/**
 * Host-side driver for the off-thread clustering worker (TASK-36.9). Forks
 * {@link cluster_worker} as a child process — mirroring the MCP-server spawn
 * pattern (`process.execPath` + `ELECTRON_RUN_AS_NODE`, so a packaged Electron
 * host runs the script as node) — ships it one window's input over IPC, and
 * resolves with the run-local result.
 *
 * This is the seam that keeps the dense O(n²) cosine build + HDBSCAN fit OFF the
 * extension-host event loop (AC #2). The orchestrator (`rebuild_clusters`) takes
 * the compute step as an injected function so tests run the pure pipeline
 * in-process; production injects {@link run_cluster_compute}, which forks.
 */
import * as child_process from "child_process";
import type {
  ClusterComputeInput,
  ClusterComputeOutput,
} from "@bergamot/tdt/out/cluster_pipeline";
import type {
  ClusterWorkerRequest,
  ClusterWorkerResponse,
} from "./cluster_worker";

export interface ClusterComputeOptions {
  /** Absolute path to the compiled `cluster_worker.js` (bundle-stable, resolved
   *  from the extension root — NOT `__dirname`, which moves when bundled). */
  worker_path: string;
  /** Hard ceiling on one window's compute before the child is killed (AC #2:
   *  a wedged fit must not pin a zombie process). Default 10 minutes. */
  timeout_ms?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Cluster one window in a forked child process. Settles exactly once: on the
 * worker's result message, on a timeout, on a spawn error, or on an unexpected
 * early exit — and always kills the child and clears the timer on the way out.
 */
export function run_cluster_compute(
  input: ClusterComputeInput,
  options: ClusterComputeOptions,
): Promise<ClusterComputeOutput> {
  return new Promise<ClusterComputeOutput>((resolve, reject) => {
    const child = child_process.fork(options.worker_path, [], {
      // The host binary run as node (a packaged install has no `node` on PATH).
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      // Structured clone so Float32Array vectors survive the IPC boundary intact.
      serialization: "advanced",
    });

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      // The worker is one-shot: kill it once we have an answer so no idle child
      // process leaks (the model/backend it loaded is released with it).
      if (child.connected) child.disconnect();
      child.kill();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `cluster worker timed out after ${options.timeout_ms ?? DEFAULT_TIMEOUT_MS}ms`,
          ),
        ),
      );
    }, options.timeout_ms ?? DEFAULT_TIMEOUT_MS);

    child.on("message", (message: ClusterWorkerResponse) => {
      if (message.ok) {
        const output = message.output;
        finish(() => resolve(output));
      } else if ("error" in message) {
        const error = message.error;
        finish(() => reject(new Error(`cluster worker failed: ${error}`)));
      }
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("exit", (code, signal) => {
      finish(() =>
        reject(
          new Error(
            `cluster worker exited before returning a result (code=${code}, signal=${signal})`,
          ),
        ),
      );
    });

    // A broken IPC channel makes send() throw SYNCHRONOUSLY — outside the
    // 'error' event — so guard it, or a failed send leaks the armed timer and an
    // un-killed child. The async-delivery error still surfaces via 'error'.
    const request: ClusterWorkerRequest = { input };
    try {
      child.send(request);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
