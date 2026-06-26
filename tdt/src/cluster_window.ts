// The clustering core — the one stage that calls clustering-tfjs (plan §6,
// Stages 4–5). It builds the dense precomputed cosine-distance matrix from the
// page vectors and runs HDBSCAN fit-only, translating the library's fitted
// state into the library-agnostic HdbscanRaw.
//
// clustering-tfjs 0.6.1 runs HDBSCAN's core-distance and mutual-reachability
// steps on a TensorFlow.js backend (a fused tf.topk / tf.maximum tidy that meets
// at one .data() readback; MST, condensed tree and label extraction stay plain
// JS). A backend is therefore required at runtime — the production host (the
// VS Code extension) supplies the native @tensorflow/tfjs-node backend. Results
// are bitwise-deterministic for a given backend, which is why the backend is
// folded into algo_version and pinned by installing exactly one (the library's
// auto-probe order tfjs-node-gpu → tfjs-node → tfjs → tfjs-core is itself a pure
// function of which backend package is present).

import * as fs from "fs";
import * as path from "path";

import { HDBSCAN } from "clustering-tfjs";
import * as tf_core from "@tensorflow/tfjs-core";

import type { PageVector, DistanceMatrix, HdbscanRaw } from "./types";
import type { HdbscanConfig } from "./config";

const ALGO_TAG = "hdbscan-1";

/**
 * Build the dense (n,n) cosine-distance matrix HDBSCAN consumes with
 * `metric: 'precomputed'` (plan §6 Stage 4). Page vectors are already
 * L2-normalized, so cosine similarity is the dot product and the cosine
 * distance is `1 − dot`. The diagonal is forced to exactly 0, the matrix is
 * symmetrized by construction, and every value is clamped to `[0, 2]` (float
 * error can push a dot product slightly outside `[-1, 1]`, and HDBSCAN's
 * mutual-reachability assumes non-negative distances).
 *
 * The page-count guard (AC#3) rejects an oversized window *before* the O(n²)
 * matrix is allocated — windowing (TASK-36.2) is meant to keep `n` under the
 * ceiling, so reaching it here is a hard error, not a recoverable case.
 *
 * Accumulation is in float64; the library re-tensors the result to float32
 * internally (`tf.tensor2d`), which is deterministic for a given backend.
 *
 * @param max_samples the WindowConfig.max_samples ceiling (windowing's hard
 *   count guard); re-checked here so an oversized window is a hard error before
 *   the O(n²) matrix is allocated.
 */
export function build_cosine_distance_matrix(
  vectors: PageVector[],
  max_samples: number,
): DistanceMatrix {
  const n = vectors.length;
  if (n > max_samples) {
    throw new Error(
      `build_cosine_distance_matrix: ${n} pages exceeds max_samples=${max_samples}; ` +
        `windowing must subdivide before clustering (plan §5).`,
    );
  }

  // Inputs are L2-normalized, finite page vectors (guaranteed by page_vectors.ts
  // and pinned by the run's embedding_model_id). Uniform dimension is the one
  // invariant a single page's construction cannot enforce; a ragged vector would
  // silently read undefined (→ NaN) or truncate in the dot loop below, poisoning
  // HDBSCAN with no clear error, so it fails loudly here instead.
  const dim = n > 0 ? vectors[0].vector.length : 0;
  for (let i = 0; i < n; i++) {
    if (vectors[i].vector.length !== dim) {
      throw new Error(
        `build_cosine_distance_matrix: page ${vectors[i].page_session_id} has dimension ` +
          `${vectors[i].vector.length}, expected ${dim}.`,
      );
    }
  }

  const D: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const vi = vectors[i].vector;
    for (let j = i + 1; j < n; j++) {
      const vj = vectors[j].vector;
      let dot = 0;
      for (let k = 0; k < vi.length; k++) dot += vi[k] * vj[k];
      let dist = 1 - dot;
      if (dist < 0) dist = 0;
      else if (dist > 2) dist = 2;
      D[i][j] = dist;
      D[j][i] = dist;
    }
  }
  return D;
}

/**
 * The single clustering-tfjs call site (plan §6 Stage 5). Builds the distance
 * matrix, fits HDBSCAN with the resolved parameters, and translates the fitted
 * `labels_` / `probabilities_` / `exemplar_indices_` into HdbscanRaw.
 *
 * `min_cluster_size` and `min_samples` are decoupled; `eom` selection stores
 * exemplars so each cluster has a single densest-core representative index.
 */
export async function cluster_window(
  vectors: PageVector[],
  config: HdbscanConfig,
  max_samples: number,
): Promise<HdbscanRaw> {
  // A window emptied by upstream exclusion (no re-downloadable text) is "no
  // clusters", not an error; the library would reject a zero-row matrix.
  if (vectors.length === 0) {
    return { labels: [], probabilities: [], exemplar_indices: new Map() };
  }

  const D = build_cosine_distance_matrix(vectors, max_samples);

  const model = new (require_hdbscan(HDBSCAN))({
    metric: "precomputed",
    min_cluster_size: config.min_cluster_size,
    min_samples: config.min_samples,
    cluster_selection_method: config.method,
    cluster_selection_epsilon: config.epsilon,
    store_exemplars: true,
  });

  try {
    await model.fit(D);
  } catch (err) {
    throw reframe_clustering_error(err);
  }

  if (model.labels_ === null || model.probabilities_ === null) {
    throw new Error("cluster_window: HDBSCAN.fit produced no labels.");
  }

  return {
    labels: model.labels_,
    probabilities: model.probabilities_,
    exemplar_indices: model.exemplar_indices_ ?? new Map(),
  };
}

/**
 * The algo_version stamped on a run (AC#5, plan §8). Records the clustering-tfjs
 * package version and the active TensorFlow backend, both of which can shift
 * marginal labels: `hdbscan-1#clustering-tfjs@0.6.1#tensorflow`.
 *
 * The backend is only known once one is active, so this must be called after a
 * `cluster_window` (which loads the backend on first fit); it throws otherwise.
 */
export function resolve_algo_version(): string {
  const backend = tf_core.getBackend();
  if (!backend) {
    throw new Error(
      "resolve_algo_version: no active TensorFlow backend; call cluster_window first.",
    );
  }
  return `${ALGO_TAG}#clustering-tfjs@${read_clustering_tfjs_version()}#${backend}`;
}

/**
 * AC#6: a TDT-framed failure when the clustering-tfjs HDBSCAN export is missing,
 * instead of an opaque "undefined is not a constructor". (A wholly absent
 * package fails earlier at import with a Node module-not-found error that already
 * names clustering-tfjs.)
 */
export function require_hdbscan(ctor: typeof HDBSCAN | undefined): typeof HDBSCAN {
  if (ctor === undefined) {
    throw new Error(
      "clustering-tfjs HDBSCAN is unavailable. Install clustering-tfjs@^0.6.1.",
    );
  }
  return ctor;
}

/**
 * AC#6: re-frame the library's backend-absent error so the fix (install the host
 * TensorFlow backend) is obvious; pass anything else through unchanged.
 *
 * Two distinct strings cover the same root cause: the library's loader throws
 * "No TensorFlow.js backend available" only when *no* @tensorflow/* package
 * resolves. Because tdt depends on @tensorflow/tfjs-core, the loader resolves a
 * backend-less core instead, and the failure surfaces later from a tf op as
 * "No backend found in registry" — the string the host actually hits when it
 * omits a compute backend like @tensorflow/tfjs-node. Both are matched.
 */
export function reframe_clustering_error(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("No TensorFlow.js backend") ||
    message.includes("No backend found in registry")
  ) {
    return new Error(
      "cluster_window: no TensorFlow.js compute backend available. The host must install " +
        "@tensorflow/tfjs-node (or another @tensorflow/* compute backend). Original: " +
        message,
    );
  }
  return err instanceof Error ? err : new Error(message);
}

function read_clustering_tfjs_version(): string {
  // The package's "exports" field blocks a direct require("clustering-tfjs/
  // package.json"), so resolve the main entry (dist/index.js) and read the
  // manifest one level up at the package root.
  const main = require.resolve("clustering-tfjs");
  const pkg_path = path.join(path.dirname(main), "..", "package.json");
  const parsed: { version?: string } = JSON.parse(fs.readFileSync(pkg_path, "utf8"));
  if (!parsed.version) {
    throw new Error(`read_clustering_tfjs_version: no version in ${pkg_path}.`);
  }
  return parsed.version;
}
