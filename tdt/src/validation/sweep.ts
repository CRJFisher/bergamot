// The parameter sweep — the one validation module that calls clustering-tfjs
// (it composes cluster_window's HDBSCAN fit and PCA for the raw/PCA-50 A/B), so
// it pulls the TensorFlow chain and is NOT re-exported from the index barrel;
// the orchestrator (task-36.9) imports it directly. tf-free scoring lives in
// scoring.ts.
//
// The harness runs the grid over already-resolved page vectors (WindowInput),
// scores each cell by HDBSCAN-native validity (mean membership probability,
// plan §10) plus noise rate excluding -1, runs the raw-vs-PCA A/B and a
// known-project recovery check, and evaluates the noise-rate / hubness guardrail
// whose PCA-promotion path it exercises. Determinism: the grid order is fixed,
// HDBSCAN is bitwise-deterministic per tf backend, and PCA takes an explicit
// random_state (its power iteration is the only randomness in the stack).

import { PCA } from "clustering-tfjs";

import { cluster_window } from "../cluster_window";
import { represent_clusters } from "../representations";
import { DEFAULT_HDBSCAN_CONFIG, type HdbscanConfig } from "../config";
import type { PageVector, HdbscanRaw } from "../types";
import {
  score_cell,
  boundary_fragmentation_count,
  aggregate_sweep,
} from "./scoring";
import type {
  GridCell,
  Reduction,
  WindowInput,
  WindowScore,
  SweepResult,
  GuardrailVerdict,
  PromotionVerdict,
  KnownProject,
} from "./types";

// The swept grid (plan §6 "Parameters", §11 step 7). Window length is upstream
// (a WindowConfig choice producing a different WindowInput set), so it is not an
// axis here; method is fixed at eom (the only method with defined exemplars).
const GRID_MIN_CLUSTER_SIZE = [3, 4, 5, 6, 7, 8];
const GRID_MIN_SAMPLES = [3, 5, 8];
const GRID_EPSILON = [0.0, 0.1, 0.2];
const GRID_REDUCTION: Reduction[] = ["raw", "pca50"];

// PCA target dim (plan §6): ~50, NOT ~5 — GDELT shows low-dim PCA collapses
// HDBSCAN to noise. The actual component count is capped by the window's rank.
const PCA_TARGET_DIM = 50;

// The fixed PCA seed. PCA's power iteration is the only randomness in the stack;
// pinning it makes the A/B and the guardrail promotion byte-reproducible.
const PCA_RANDOM_STATE = 42;

// Never emit a zero reduced vector: a zero row reads as orthogonal-to-everything
// and poisons the cosine matrix (mirrors representations.ts).
const NORM_EPSILON = 1e-6;

// The fraction of a known project's pages that must land in one cluster for it to
// count as recovered (AC#2) — below this, or a modal label of -1, means the
// project dissolved into noise.
const RECOVERY_THRESHOLD = 0.6;

// Guardrail trip thresholds (plan §6 "Noise-rate / hubness guardrail").
// NOISE_TRIP_CEILING (when to ESCALATE to PCA) is deliberately a separate knob
// from operating_point.ts's HEALTHY_NOISE_CEILING (when to REJECT a cell as the
// operating point): the two answer different questions and may be tuned apart,
// even though they start at the same 0.65 band edge. Keep that in mind if you
// re-tune one — they are not required to move together.
const NOISE_TRIP_CEILING = 0.65; // noise fraction persistently above this band
const MEDIAN_COLLAPSE_SLACK = 1; // median cluster size within this of min_cluster_size

/**
 * Enumerate the grid in a fixed order (reduction, then min_cluster_size,
 * min_samples, epsilon). 108 cells. The order is the deterministic tie-break
 * anchor the operating-point selection falls back to.
 */
export function build_grid(): GridCell[] {
  const cells: GridCell[] = [];
  for (const reduction of GRID_REDUCTION) {
    for (const min_cluster_size of GRID_MIN_CLUSTER_SIZE) {
      for (const min_samples of GRID_MIN_SAMPLES) {
        for (const epsilon of GRID_EPSILON) {
          cells.push({
            min_cluster_size,
            min_samples,
            epsilon,
            method: "eom",
            reduction,
          });
        }
      }
    }
  }
  return cells;
}

/**
 * Reduce page vectors to ~50d via deterministic PCA, then L2-renormalize (AC#2,
 * plan §6 Stage 3). The renorm is load-bearing: the precomputed-cosine path
 * assumes unit vectors so cosine = dot, and PCA output is centered, not unit.
 *
 * Tiny-window guard: PCA has at most n−1 non-degenerate components, so
 * n_components = min(50, n−1, dim). When that is < 1 (a window of ≤ 1 page) the
 * reduction is a no-op — a 1-page window has no principal subspace and is not
 * clustered into anything anyway. Row order and page_session_id are preserved so
 * the parallel-array contract with `visits` survives the reduction.
 */
export function reduce_pca50(
  vectors: PageVector[],
  random_state: number = PCA_RANDOM_STATE,
): PageVector[] {
  const n = vectors.length;
  if (n === 0) return [];
  const dim = vectors[0].vector.length;
  const n_components = Math.min(PCA_TARGET_DIM, n - 1, dim);
  if (n_components < 1) return vectors;

  const X = vectors.map((v) => Array.from(v.vector));
  const pca = new PCA({ n_components, random_state });
  const Z = pca.fit_transform(X);

  return Z.map((row, i) => ({
    page_session_id: vectors[i].page_session_id,
    vector: l2_normalize_or_basis(row),
    low_confidence: vectors[i].low_confidence,
  }));
}

/**
 * Run one (window, cell): optionally reduce, cluster through the shared cosine /
 * HDBSCAN path, score (excluding -1), measure boundary fragmentation, and check
 * known-project recovery. `max_samples` re-guards the window size at the matrix
 * build (windowing should already keep n under the ceiling).
 */
export async function run_window_cell(
  window: WindowInput,
  cell: GridCell,
  max_samples: number,
  known_project: KnownProject | null,
  random_state: number = PCA_RANDOM_STATE,
): Promise<WindowScore> {
  const vectors =
    cell.reduction === "pca50"
      ? reduce_pca50(window.vectors, random_state)
      : window.vectors;

  const hdbscan_config: HdbscanConfig = {
    min_cluster_size: cell.min_cluster_size,
    min_samples: cell.min_samples,
    method: "eom",
    epsilon: cell.epsilon,
  };

  const raw = await cluster_window(vectors, hdbscan_config, max_samples);
  const score = score_cell(raw);
  const clusters = await represent_clusters(raw, vectors, window.visits);
  const boundary_fragmentation = boundary_fragmentation_count(
    clusters,
    window.window_start,
    window.window_end,
  );
  const recovered =
    known_project === null
      ? false
      : check_known_project_recovery(raw, window, known_project);

  return {
    window_start: window.window_start,
    window_end: window.window_end,
    cell,
    score,
    boundary_fragmentation,
    known_project_recovered: recovered,
  };
}

export interface SweepOptions {
  max_samples: number;
  known_project?: KnownProject;
  random_state?: number;
}

/**
 * Run the full grid over every window and aggregate per cell (AC#1). Returns one
 * SweepResult per grid cell (108). Deterministic: fixed grid order, fixed window
 * order, fixed PCA seed, HDBSCAN bitwise-deterministic per backend.
 */
export async function run_sweep(
  windows: WindowInput[],
  options: SweepOptions,
): Promise<SweepResult[]> {
  const known_project = options.known_project ?? null;
  const random_state = options.random_state ?? PCA_RANDOM_STATE;
  const grid = build_grid();
  const results: SweepResult[] = [];

  for (const cell of grid) {
    const per_window: WindowScore[] = [];
    for (const window of windows) {
      per_window.push(
        await run_window_cell(
          window,
          cell,
          options.max_samples,
          known_project,
          random_state,
        ),
      );
    }
    results.push({ cell, per_window, ...aggregate_sweep(per_window) });
  }
  return results;
}

/**
 * Does the labeled known project recover as one cluster (AC#2)? True when the
 * plurality of its pages share one cluster label ≥ 0 and that plurality fraction
 * meets RECOVERY_THRESHOLD. A modal label of -1, or a plurality below threshold,
 * means the project dissolved into noise.
 */
export function check_known_project_recovery(
  raw: HdbscanRaw,
  window: WindowInput,
  known_project: KnownProject,
): boolean {
  const wanted = new Set(known_project.page_session_ids);
  if (wanted.size === 0) return false;

  const label_counts = new Map<number, number>();
  let found = 0;
  for (let i = 0; i < window.visits.length; i++) {
    if (!wanted.has(window.visits[i].page_session_id)) continue;
    found++;
    const label = raw.labels[i];
    label_counts.set(label, (label_counts.get(label) ?? 0) + 1);
  }
  if (found === 0) return false;

  let best_label = -1;
  let best_count = 0;
  for (const [label, count] of label_counts) {
    if (count > best_count) {
      best_count = count;
      best_label = label;
    }
  }
  if (best_label < 0) return false; // dissolved into noise
  return best_count / found >= RECOVERY_THRESHOLD;
}

/**
 * Evaluate the noise-rate / hubness guardrail over the default-params raw cell
 * (AC#3, plan §6). It trips when that cell's noise fraction persistently exceeds
 * the band OR its typical cluster size collapses toward min_cluster_size — the
 * silent over-noising "aggressive noise rejection" would otherwise mask. On a
 * trip, the PCA-promotion path runs and records its comparative verdict.
 *
 * "Exercised" (AC#3) means this path RUNS and is asserted — NOT that synthetic
 * PCA must beat raw. pca_improves records the outcome either way; the raw/PCA
 * A/B (plan §6) adopts raw only if it wins or ties.
 */
export function evaluate_guardrail(results: SweepResult[]): GuardrailVerdict {
  const raw_default = find_default_cell(results, "raw");
  if (raw_default === null) {
    return { tripped: false, reason: "healthy", promotion: null };
  }

  const noise_trips = raw_default.mean_noise_fraction > NOISE_TRIP_CEILING;
  const size = raw_default.median_cluster_size_typical;
  const size_collapses =
    size !== null && size <= raw_default.cell.min_cluster_size + MEDIAN_COLLAPSE_SLACK;

  if (!noise_trips && !size_collapses) {
    return { tripped: false, reason: "healthy", promotion: null };
  }

  return {
    tripped: true,
    reason: noise_trips ? "noise_persistent" : "median_size_collapse",
    promotion: run_pca_promotion(results),
  };
}

/**
 * The PCA-promotion comparison (AC#3): the default-params raw cell vs the
 * default-params PCA cell, both already computed by run_sweep, so no
 * re-clustering. pca_improves is true when PCA lowers noise or raises the
 * coherence signal at the same params.
 */
export function run_pca_promotion(results: SweepResult[]): PromotionVerdict {
  const raw_cell = find_default_cell(results, "raw");
  const pca_cell = find_default_cell(results, "pca50");
  if (raw_cell === null || pca_cell === null) {
    throw new Error(
      "run_pca_promotion: sweep is missing a default-params raw or pca50 cell.",
    );
  }
  const raw_prob = raw_cell.mean_membership_probability;
  const pca_prob = pca_cell.mean_membership_probability;
  const pca_improves =
    pca_cell.mean_noise_fraction < raw_cell.mean_noise_fraction ||
    (pca_prob !== null && (raw_prob === null || pca_prob > raw_prob));
  return {
    raw_mean_noise_fraction: raw_cell.mean_noise_fraction,
    pca_mean_noise_fraction: pca_cell.mean_noise_fraction,
    raw_mean_membership_probability: raw_prob,
    pca_mean_membership_probability: pca_prob,
    pca_improves,
  };
}

// --- internal helpers -------------------------------------------------------

// The default-params cell for a reduction: the SHIP default (DEFAULT_HDBSCAN_CONFIG,
// plan §6), so the guardrail provably anchors to the real default rather than bare
// literals that would silently drift if the default ever changed. A single
// well-defined cell, not an ambiguous "across cells" aggregate.
function find_default_cell(
  results: SweepResult[],
  reduction: Reduction,
): SweepResult | null {
  return (
    results.find(
      (r) =>
        r.cell.reduction === reduction &&
        r.cell.min_cluster_size === DEFAULT_HDBSCAN_CONFIG.min_cluster_size &&
        r.cell.min_samples === DEFAULT_HDBSCAN_CONFIG.min_samples &&
        r.cell.epsilon === DEFAULT_HDBSCAN_CONFIG.epsilon,
    ) ?? null
  );
}

// L2-normalize a reduced row in float64, truncating to float32 once (mirrors
// page_vectors.ts). A degenerate row (a point at the data centroid → near-zero
// norm) falls back to the first basis vector rather than an un-normalizable zero.
function l2_normalize_or_basis(row: number[]): Float32Array {
  let norm = 0;
  for (const x of row) norm += x * x;
  norm = Math.sqrt(norm);
  const out = new Float32Array(row.length);
  if (norm < NORM_EPSILON) {
    out[0] = 1;
    return out;
  }
  const inv = 1 / norm;
  for (let d = 0; d < row.length; d++) out[d] = row[d] * inv;
  return out;
}
