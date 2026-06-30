/**
 * The off-thread clustering worker (TASK-36.9, plan §11 step 9). A child process
 * forked by {@link run_cluster_compute}, mirroring the MCP-server spawn pattern
 * (`mcp_server_manager.ts`): it exists so the multi-second dense O(n²) cosine
 * build + HDBSCAN fit run OFF the extension-host event loop, leaving the UI and
 * the `/visit` capture endpoint responsive during a run (AC #2).
 *
 * It receives one window's page vectors + visits over IPC, runs the pure
 * `compute_clusters` (the only clustering-tfjs call site, which loads its own
 * TensorFlow backend in this process), and sends the run-local result back. It
 * touches NO DuckDB and NO vscode APIs — so it can never contend for the
 * single-writer database (plan §3); the parent's writer persists the result.
 *
 * IPC uses advanced (structured-clone) serialization so the `Float32Array` page
 * vectors and representative vectors cross the boundary as typed arrays, not as
 * JSON-mangled plain objects (the parent sets `serialization: 'advanced'`).
 */
import "./util_node24_compat";
import { compute_clusters } from "@bergamot/tdt/out/cluster_pipeline";
import type {
  ClusterComputeInput,
  ClusterComputeOutput,
} from "@bergamot/tdt/out/cluster_pipeline";

/** Parent → worker: the one window to cluster. */
export interface ClusterWorkerRequest {
  input: ClusterComputeInput;
}

/** Worker → parent: the result, or a stringified failure (the process stays up
 *  for the parent to read the message, then the parent kills it). */
export type ClusterWorkerResponse =
  | { ok: true; output: ClusterComputeOutput }
  | { ok: false; error: string };

async function handle(message: ClusterWorkerRequest): Promise<void> {
  try {
    const output = await compute_clusters(message.input);
    send({ ok: true, output });
  } catch (error) {
    send({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function send(response: ClusterWorkerResponse): void {
  // process.send exists because this module only ever runs as a forked child.
  process.send?.(response);
}

process.on("message", (message: ClusterWorkerRequest) => {
  void handle(message);
});
