// The chosen operating point, persisted as CONFIG DATA, parameterized by window
// size (AC#4, plan §6 "Defaults are starting points selected by the validation
// sweep, persisted as config"). config.ts holds the search space (the grid's
// starting defaults); this module holds the SELECTED point as a JSON data file,
// so re-tuning as history grows is a data edit, not a code change.
//
// tf-free: pure selection + fs round-trip, no clustering-tfjs, no Date.now()
// (the timestamp is injected). Safe to re-export from the barrel.

import * as fs from "fs";
import * as path from "path";

import type { Reduction, SweepResult } from "./types";

// A cell with a healthy noise fraction is neither over-merging (near-zero noise:
// every one-off forced into a project) nor over-noising (above the ceiling: the
// curse-of-dimensionality failure plan §6 guards against). The band is the
// selection gate; re-tune as a data question against a labeled window.
const HEALTHY_NOISE_FLOOR = 0.05;
const HEALTHY_NOISE_CEIL = 0.65;

export interface OperatingPointEntry {
  min_cluster_size: number;
  min_samples: number;
  method: "eom";
  epsilon: number;
  reduction: Reduction;
}

export interface OperatingPoint {
  version: 1;
  // Keyed by window unit ("month", "14d", ...) so the operating point is
  // parameterized by window size (AC#4).
  by_window_unit: Record<string, OperatingPointEntry>;
  selected_at: string; // injected ISO-8601; never Date.now()
  provenance: string; // how this point was chosen (sweep run vs design-default seed)
}

/**
 * Select the best grid cell for one window-length sweep (AC#1, AC#4). Among cells
 * in the healthy noise band that recover the known project and have a defined
 * coherence signal, pick the maximum mean membership probability. Ties break
 * deterministically: lower noise, then smaller params (min_cluster_size,
 * min_samples, epsilon), then reduction order (raw before pca50) — the grid's
 * fixed enumeration order is the final fallback.
 *
 * @throws when no cell clears the gate — a degenerate cell must never be selected
 *   silently; widen the band or inspect the sweep.
 */
export function select_operating_point(
  results: SweepResult[],
): OperatingPointEntry {
  const healthy = results.filter(
    (r) =>
      r.mean_membership_probability !== null &&
      r.mean_noise_fraction >= HEALTHY_NOISE_FLOOR &&
      r.mean_noise_fraction <= HEALTHY_NOISE_CEIL &&
      r.known_project_recovered,
  );
  if (healthy.length === 0) {
    throw new Error(
      "select_operating_point: no grid cell met the healthy-noise + " +
        "known-project-recovery gate; widen the band or inspect the sweep.",
    );
  }

  let best = healthy[0];
  for (const r of healthy.slice(1)) {
    if (compare_cells(r, best) < 0) best = r;
  }
  return {
    min_cluster_size: best.cell.min_cluster_size,
    min_samples: best.cell.min_samples,
    method: "eom",
    epsilon: best.cell.epsilon,
    reduction: best.cell.reduction,
  };
}

// Returns < 0 when `a` is the better operating point than `b`. Probability is
// known non-null here (selection filters nulls out). Every tie-break is total, so
// the result is independent of input order.
function compare_cells(a: SweepResult, b: SweepResult): number {
  const pa = a.mean_membership_probability as number;
  const pb = b.mean_membership_probability as number;
  if (pa !== pb) return pb - pa; // higher probability first
  if (a.mean_noise_fraction !== b.mean_noise_fraction) {
    return a.mean_noise_fraction - b.mean_noise_fraction; // lower noise first
  }
  if (a.cell.min_cluster_size !== b.cell.min_cluster_size) {
    return a.cell.min_cluster_size - b.cell.min_cluster_size;
  }
  if (a.cell.min_samples !== b.cell.min_samples) {
    return a.cell.min_samples - b.cell.min_samples;
  }
  if (a.cell.epsilon !== b.cell.epsilon) return a.cell.epsilon - b.cell.epsilon;
  return reduction_rank(a.cell.reduction) - reduction_rank(b.cell.reduction);
}

function reduction_rank(r: Reduction): number {
  return r === "raw" ? 0 : 1;
}

/** Human-readable, stable JSON for the checked-in data file. */
export function serialize_operating_point(point: OperatingPoint): string {
  return JSON.stringify(point, null, 2) + "\n";
}

/**
 * Parse + validate an operating-point file. Fails loud on a malformed or
 * wrong-version file (a stale cache key would silently mis-cluster). No `as any`:
 * the shape is narrowed by checking each field.
 */
export function parse_operating_point(text: string): OperatingPoint {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("parse_operating_point: not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`parse_operating_point: unsupported version ${obj.version}`);
  }
  if (typeof obj.selected_at !== "string" || typeof obj.provenance !== "string") {
    throw new Error("parse_operating_point: missing selected_at/provenance");
  }
  if (typeof obj.by_window_unit !== "object" || obj.by_window_unit === null) {
    throw new Error("parse_operating_point: missing by_window_unit");
  }
  const by_window_unit: Record<string, OperatingPointEntry> = {};
  for (const [unit, entry] of Object.entries(
    obj.by_window_unit as Record<string, unknown>,
  )) {
    by_window_unit[unit] = parse_entry(unit, entry);
  }
  return {
    version: 1,
    by_window_unit,
    selected_at: obj.selected_at,
    provenance: obj.provenance,
  };
}

function parse_entry(unit: string, entry: unknown): OperatingPointEntry {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`parse_operating_point: entry "${unit}" is not an object`);
  }
  const e = entry as Record<string, unknown>;
  if (
    typeof e.min_cluster_size !== "number" ||
    typeof e.min_samples !== "number" ||
    typeof e.epsilon !== "number"
  ) {
    throw new Error(`parse_operating_point: entry "${unit}" has non-numeric params`);
  }
  if (e.method !== "eom") {
    throw new Error(`parse_operating_point: entry "${unit}" method must be "eom"`);
  }
  if (e.reduction !== "raw" && e.reduction !== "pca50") {
    throw new Error(`parse_operating_point: entry "${unit}" reduction invalid`);
  }
  return {
    min_cluster_size: e.min_cluster_size,
    min_samples: e.min_samples,
    method: "eom",
    epsilon: e.epsilon,
    reduction: e.reduction,
  };
}

// The shipped data file at the package root. The root is found by walking up
// from this module to the directory holding package.json, so the path is correct
// whether this runs as TypeScript under ts-jest (src/validation/...) or as
// compiled JS (out/validation/...) — the two layouts differ by an intermediate
// dir, which a fixed "../.." would resolve to the wrong place. Exported so tests
// can point at a fixture instead.
export function operating_point_path(): string {
  return path.join(find_package_root(__dirname), "operating_point.json");
}

function find_package_root(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `operating_point_path: no package.json found above ${start}`,
      );
    }
    dir = parent;
  }
}

export function load_operating_point(
  file_path: string = operating_point_path(),
): OperatingPoint {
  return parse_operating_point(fs.readFileSync(file_path, "utf-8"));
}
