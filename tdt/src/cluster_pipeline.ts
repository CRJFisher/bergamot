// The tf-pulling compute pipeline (plan §6 Stages 4–7, build-order step 9). One
// pure function that composes the three clustering-tfjs stages — the HDBSCAN fit
// (cluster_window), the representations (represent_clusters), and the frozen
// algo_version — plus the tf-free deterministic labeler, into a single
// vectors-in / results-out unit.
//
// It is the body the TASK-36.9 orchestrator runs OFF the extension-host event
// loop (plan §11 step 9): a multi-second dense O(n²) cosine build + fit must not
// freeze the UI or stall /visit capture, so the extension forks a child process
// (vscode/src/tdt/cluster_worker.ts) whose only job is to call this. The function
// touches NO DuckDB and NO vscode types — vectors and visits in, run-local
// results out — so the worker can never hold the single-writer database (plan §3).
//
// Like cluster_window.ts / representations.ts it imports clustering-tfjs (the
// native TensorFlow chain), so it is NOT re-exported from the index barrel; the
// worker imports it directly.

import { cluster_window, resolve_algo_version } from "./cluster_window";
import { represent_clusters } from "./representations";
import { label_cluster, type LabelerConfig } from "./labeling/deterministic_labeler";
import type { VisitRow, PageVector, RepresentedCluster, ClusterLabel } from "./types";
import type { HdbscanConfig } from "./config";

/**
 * One window's compute input. `visits` and `vectors` are PARALLEL rows in the §6
 * stable fetch order (`page_loaded_at, page_session_id`): `visits[i]` and
 * `vectors[i]` describe the same i-th page. The orchestrator filters to pages
 * that have a cached vector before building these, so the two are always aligned
 * and non-empty (a window with no vectored pages is skipped upstream).
 */
export interface ClusterComputeInput {
  visits: VisitRow[];
  vectors: PageVector[];
  hdbscan: HdbscanConfig;
  /** The WindowConfig.max_samples ceiling, re-checked before the O(n²) build. */
  max_samples: number;
  /** Labeler knobs; the deterministic default applies when omitted. */
  labeler_config?: LabelerConfig;
}

/**
 * The run-local compute result the orchestrator assembles into a RunBundle.
 *
 * `labels` / `probabilities` are the parallel per-row HDBSCAN output;
 * `represented` + `cluster_labels` are index-aligned, one per cluster (label ≥ 0).
 * The HdbscanRaw `exemplar_indices` Map is deliberately NOT surfaced: the
 * exemplar identity it carries is already resolved into
 * `represented[].representative_index`, so nothing downstream of the worker reads
 * it — keeping the cross-process payload to plain arrays + Float32Arrays.
 */
export interface ClusterComputeOutput {
  labels: number[];
  probabilities: number[];
  represented: RepresentedCluster[];
  cluster_labels: ClusterLabel[];
  algo_version: string;
}

/**
 * Cluster one window: build the cosine matrix + fit HDBSCAN, represent each
 * cluster, label it, and stamp the active-backend algo_version. Deterministic for
 * a given backend (the §6 determinism contract); the orchestrator persists the
 * result idempotently.
 *
 * Requires `vectors.length > 0` — `resolve_algo_version` reads the backend the
 * fit activates, so it has nothing to report for an unfitted empty window. The
 * orchestrator guarantees this by skipping vector-less windows before calling.
 */
export async function compute_clusters(
  input: ClusterComputeInput,
): Promise<ClusterComputeOutput> {
  const raw = await cluster_window(input.vectors, input.hdbscan, input.max_samples);
  const represented = await represent_clusters(raw, input.vectors, input.visits);
  const cluster_labels = represented.map((rc) =>
    label_cluster(rc, input.visits, input.labeler_config),
  );
  const algo_version = resolve_algo_version();
  return {
    labels: raw.labels,
    probabilities: raw.probabilities,
    represented,
    cluster_labels,
    algo_version,
  };
}
