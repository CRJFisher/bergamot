// Pure scoring for the validation harness (task-36.7, plan §10). tf-free: no
// clustering-tfjs, no TensorFlow backend, no Date.now(). Every function is a
// deterministic arithmetic over already-computed HDBSCAN output, so this module
// is unit-testable without a backend and is safe to re-export from the barrel.
//
// The coherence signal is mean membership probability over NON-noise points, NOT
// silhouette and NOT a cluster-persistence score: clustering-tfjs 0.6.1's
// silhouette is Euclidean-only and noise-naive, and it exposes no
// cluster_persistence attribute (plan §10). Label -1 is excluded from every
// score — the one honest signal HDBSCAN produces fit-only.

import type { HdbscanRaw, RepresentedCluster, VisitRow } from "../types";
import type { VectorStore } from "../ports";
import type {
  CellScore,
  CrossWindowVariance,
  VarianceStat,
  WindowScore,
  SweepResult,
  VisitsPerMonth,
  ValidationReport,
} from "./types";

// A cluster's time span "touches" a window edge when its earliest member sits at
// the window start or its latest member sits at the (exclusive) window end. The
// window is half-open [start, end), so the last admissible instant is end − 1ms;
// the tolerance covers that exclusive-bound asymmetry and a member landing in the
// first/last second of the window. All values are integer epoch-ms (Date.parse of
// the ISO forms windowing emits), so this is NOT float slop — it is the genuine
// "is this cluster at the boundary" width.
const BOUNDARY_TOLERANCE_MS = 1000;

/**
 * Score one HDBSCAN result, excluding noise (-1) from every field (plan §10).
 * mean_membership_probability and median_cluster_size are null (never 0) for an
 * all-noise window: it has no cluster to score and must not out-rank a
 * real-but-weak cluster.
 */
export function score_cell(raw: HdbscanRaw): CellScore {
  const n = raw.labels.length;

  let noise = 0;
  let prob_sum = 0;
  let non_noise = 0;
  const sizes_by_label = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const label = raw.labels[i];
    if (label < 0) {
      noise++;
      continue;
    }
    prob_sum += raw.probabilities[i];
    non_noise++;
    sizes_by_label.set(label, (sizes_by_label.get(label) ?? 0) + 1);
  }

  const cluster_count = sizes_by_label.size;
  return {
    n,
    cluster_count,
    noise_fraction: n === 0 ? 0 : noise / n,
    mean_membership_probability: non_noise === 0 ? null : prob_sum / non_noise,
    median_cluster_size:
      cluster_count === 0 ? null : median([...sizes_by_label.values()]),
  };
}

/**
 * Count clusters whose time span touches either window edge (AC#5,
 * plan §12 "Window-boundary fragmentation"). Comparisons are on parsed epoch-ms,
 * never raw ISO strings — mixed `Z` / `+00:00` / `.SSS` forms are not
 * lexicographically ordered (mirrors representations.ts).
 */
export function boundary_fragmentation_count(
  clusters: RepresentedCluster[],
  window_start: string,
  window_end: string,
): number {
  const ws = Date.parse(window_start);
  const we = Date.parse(window_end);
  let count = 0;
  for (const c of clusters) {
    const start_ms = Date.parse(c.time_span.start);
    const end_ms = Date.parse(c.time_span.end);
    const touches_start = start_ms - ws <= BOUNDARY_TOLERANCE_MS;
    const touches_end = we - end_ms <= BOUNDARY_TOLERANCE_MS;
    if (touches_start || touches_end) count++;
  }
  return count;
}

/**
 * Cross-window dispersion of per-window N, cluster count, and noise fraction
 * (AC#5). This is the evidence gate for the windowing seam (plan §5): high
 * variance argues for target-N re-windowing — but only as the SECOND lever,
 * after minClusterSize-as-a-fraction-of-N. The harness REPORTS it; it never acts.
 */
export function cross_window_variance(scores: CellScore[]): CrossWindowVariance {
  return {
    n: variance_stat(scores.map((s) => s.n)),
    cluster_count: variance_stat(scores.map((s) => s.cluster_count)),
    noise_fraction: variance_stat(scores.map((s) => s.noise_fraction)),
  };
}

/**
 * Live visits-per-month distribution (AC#5), the cadence evidence task-36.9
 * consumes. Pure over visit metadata — no re-download, no vectors. Buckets by the
 * UTC calendar month of page_loaded_at and returns months in ascending order.
 */
export function visits_per_month(visits: VisitRow[]): VisitsPerMonth[] {
  const counts = new Map<string, number>();
  for (const v of visits) {
    const month = month_key_utc(v.page_loaded_at);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([month, n]) => ({ month, visits: n }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/**
 * Aggregate one cell's per-window scores into the SweepResult fields the
 * guardrail and the operating-point selector consume. Null per-window
 * probabilities (all-noise windows) are ignored, not treated as 0. A cell
 * "recovers" the known project when it does so in strictly more than half the
 * windows.
 */
export function aggregate_sweep(
  per_window: WindowScore[],
): Pick<
  SweepResult,
  | "mean_membership_probability"
  | "mean_noise_fraction"
  | "median_cluster_size_typical"
  | "known_project_recovered"
> {
  const probs = per_window
    .map((w) => w.score.mean_membership_probability)
    .filter((p): p is number => p !== null);
  const noises = per_window.map((w) => w.score.noise_fraction);
  const medians = per_window
    .map((w) => w.score.median_cluster_size)
    .filter((m): m is number => m !== null);
  const recovered = per_window.filter((w) => w.known_project_recovered).length;

  return {
    mean_membership_probability: probs.length === 0 ? null : mean(probs),
    mean_noise_fraction: noises.length === 0 ? 0 : mean(noises),
    median_cluster_size_typical: medians.length === 0 ? null : median(medians),
    known_project_recovered: recovered * 2 > per_window.length,
  };
}

/**
 * Roll the four AC#5 signals up for one chosen cell into a single report, so
 * "the harness reports X" is one struct rather than four loose helpers a
 * downstream consumer must assemble. tf-free and pure: the orchestrator runs
 * run_sweep (which needs the backend), picks the cell it would ship (the default
 * raw cell), and hands its per-window scores plus the gathered visits and the
 * already-measured re-download volume here.
 */
export function summarize_validation(
  scored_windows: WindowScore[],
  visits: VisitRow[],
  redownload_page_count: number,
): ValidationReport {
  let total_boundary_fragmentation = 0;
  for (const w of scored_windows) {
    total_boundary_fragmentation += w.boundary_fragmentation;
  }
  return {
    cross_window_variance: cross_window_variance(
      scored_windows.map((w) => w.score),
    ),
    total_boundary_fragmentation,
    visits_per_month: visits_per_month(visits),
    redownload_page_count,
  };
}

/**
 * Per-run re-download volume (AC#5): how many of a window's pages are absent from
 * the topic_page_vector cache — the new public pages a run must re-download and
 * embed. With visits_per_month this is the evidence for the task-36.9 once/day
 * trigger cadence. The only validation function needing the VectorStore port, but
 * tf-free, so it lives here beside its cadence sibling visits_per_month (not in
 * the tf-pulling sweep.ts) and the orchestrator gets cadence evidence without
 * bundling TensorFlow.
 */
export async function redownload_volume(
  page_session_ids: string[],
  embedding_model_id: string,
  store: VectorStore,
): Promise<number> {
  let missing = 0;
  for (const id of page_session_ids) {
    const cached = await store.get(id, embedding_model_id);
    if (cached === null) missing++;
  }
  return missing;
}

// --- internal helpers -------------------------------------------------------

function variance_stat(values: number[]): VarianceStat {
  const count = values.length;
  if (count === 0) {
    return { mean: 0, variance: 0, min: 0, max: 0, count: 0 };
  }
  const m = mean(values);
  let sq = 0;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    sq += (v - m) * (v - m);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { mean: m, variance: sq / count, min, max, count };
}

function mean(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// Median of a non-empty list; mean of the two middles for an even count.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// "YYYY-MM" of an ISO-8601 instant in UTC. Date parsing is spec-guaranteed for
// ISO-8601; the month is read off the UTC calendar, not the local one.
function month_key_utc(iso: string): string {
  const d = new Date(iso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
