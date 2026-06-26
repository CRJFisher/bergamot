// Validation-harness DTOs (plan §11 step 7, task-36.7). tf-free leaf module:
// imports only the package's own VisitRow/PageVector. Both the tf module
// (sweep.ts) and the tf-free modules (scoring.ts, operating_point.ts) depend on
// these types, so keeping them here lets neither pull the TensorFlow chain.

import type { VisitRow, PageVector } from "../types";

// Stage-3 reducer choice (plan §6). "raw" feeds the page vectors straight to the
// cosine matrix; "pca50" reduces to ~50d first (the A/B and the guardrail's
// escalation lever). UMAP is never an option (non-deterministic).
export type Reduction = "raw" | "pca50";

// One window's already-resolved clustering input. The harness operates on
// RESOLVED page vectors, not raw data: the §11 batch CLI fetches visits and
// resolves vectors through the real ports first, then hands the harness a pure,
// deterministic compute. `visits` and `vectors` are PARALLEL — visits[i] and
// vectors[i] describe the same i-th row fed to clustering (the determinism
// anchor of plan §6 Stage 1).
export interface WindowInput {
  window_start: string; // ISO-8601 UTC, inclusive (ACTUAL bounds, post-subdivision)
  window_end: string; // ISO-8601 UTC, exclusive
  visits: VisitRow[];
  vectors: PageVector[]; // already-resolved, L2-normalized
}

// One point in the parameter grid (plan §6 "Parameters"). `method` is fixed at
// "eom" — the only selection method with library-defined exemplars, which the
// representatives need. `reduction` crosses the HDBSCAN grid with the raw/PCA
// A/B. Window length is NOT here: it is an upstream WindowConfig choice that
// produces a different WindowInput set, swept by running the harness per set.
export interface GridCell {
  min_cluster_size: number;
  min_samples: number;
  epsilon: number;
  method: "eom";
  reduction: Reduction;
}

// One cell's score on one window. Label -1 (noise) is excluded from every field
// (plan §10): the shipped silhouette is Euclidean-only and noise-naive, so the
// coherence signal is mean membership probability over NON-noise points.
export interface CellScore {
  n: number; // rows fed to clustering (window size)
  cluster_count: number; // distinct labels >= 0
  noise_fraction: number; // |label == -1| / n; 0 when n == 0
  // HDBSCAN-native validity. clustering-tfjs 0.6.1 exposes NO cluster_persistence
  // attribute, so this is the mean of probabilities_ over points with label >= 0.
  // null (not 0) when there are zero non-noise points — an all-noise cell has no
  // cluster to score and must never out-rank a real-but-weak one.
  mean_membership_probability: number | null;
  median_cluster_size: number | null; // null when cluster_count == 0
}

// One (window, cell) fully scored, with the two per-window signals that are not
// pure functions of the HDBSCAN labels alone.
export interface WindowScore {
  window_start: string;
  window_end: string;
  cell: GridCell;
  score: CellScore;
  boundary_fragmentation: number; // clusters whose time span touches a window edge
  known_project_recovered: boolean; // the labeled project landed in ONE cluster
}

// One grid cell aggregated across every window in the sweep — the unit
// select_operating_point ranks and the guardrail inspects.
export interface SweepResult {
  cell: GridCell;
  per_window: WindowScore[];
  mean_membership_probability: number | null; // mean over windows where defined; null if none
  mean_noise_fraction: number;
  median_cluster_size_typical: number | null; // median of per-window medians
  known_project_recovered: boolean; // recovered in > half the windows
}

// Per-window dispersion of the three series that gate the windowing seam
// (plan §5). High variance is the evidence to activate target-N re-windowing —
// but only as the SECOND lever, after minClusterSize-as-a-fraction-of-N.
export interface VarianceStat {
  mean: number;
  variance: number; // population variance (÷ count) — a descriptive summary, not an estimate
  min: number;
  max: number;
  count: number;
}

export interface CrossWindowVariance {
  n: VarianceStat;
  cluster_count: VarianceStat;
  noise_fraction: VarianceStat;
}

// The noise-rate / hubness guardrail verdict (plan §6). When tripped, the
// PCA-promotion path runs and records its comparative outcome.
export interface GuardrailVerdict {
  tripped: boolean;
  reason: "noise_persistent" | "median_size_collapse" | "healthy";
  promotion: PromotionVerdict | null; // populated iff tripped
}

// The raw-vs-PCA comparison the promotion path produces. `pca_improves` records
// the verdict either way — the guardrail's job is to EXERCISE the escalation
// path and measure it, not to guarantee PCA wins (plan §6, the A/B is "adopt raw
// only if it wins or ties").
export interface PromotionVerdict {
  raw_mean_noise_fraction: number;
  pca_mean_noise_fraction: number;
  raw_mean_membership_probability: number | null;
  pca_mean_membership_probability: number | null;
  pca_improves: boolean; // PCA lowers noise OR raises mean probability at the same params
}

// Cadence evidence for task-36.9: the live visits-per-month distribution. With
// per-run re-download volume it justifies the once/day automatic-trigger default.
export interface VisitsPerMonth {
  month: string; // "YYYY-MM" (UTC)
  visits: number;
}

// A WindowInput tagged with the known-project page set to confirm recovery
// against (AC#2). Optional per sweep: when absent, recovery is not evaluated.
export interface KnownProject {
  page_session_ids: string[];
}
