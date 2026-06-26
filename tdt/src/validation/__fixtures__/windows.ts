// Shared deterministic fixtures for the validation-harness tests. No RNG: every
// vector is a fixed function of its index, so HDBSCAN output is byte-stable and
// the harness's determinism tests are meaningful. Mirrors cluster_window.test.ts.

import type { PageVector, VisitRow } from "../../types";
import type { WindowInput } from "../types";

function l2_normalize(parts: number[]): Float32Array {
  let norm = 0;
  for (const x of parts) norm += x * x;
  norm = Math.sqrt(norm);
  return Float32Array.from(parts, (x) => x / norm);
}

function page_vector(id: string, parts: number[]): PageVector {
  return {
    page_session_id: id,
    vector: l2_normalize(parts),
    low_confidence: false,
  };
}

// A visit row-aligned to a vector by page_session_id (the parallel-array
// contract represent_clusters asserts). title/url are minimal — scoring and
// fragmentation only read page_session_id and page_loaded_at.
function visit(id: string, page_loaded_at: string): VisitRow {
  return {
    page_session_id: id,
    url: `https://example.com/${id}`,
    title: id,
    site_name: "example.com",
    page_loaded_at,
    tree_id: "t1",
  };
}

// Build a WindowInput from (id, parts, page_loaded_at) triples, preserving order.
export function make_window(
  window_start: string,
  window_end: string,
  rows: { id: string; parts: number[]; at: string }[],
): WindowInput {
  return {
    window_start,
    window_end,
    visits: rows.map((r) => visit(r.id, r.at)),
    vectors: rows.map((r) => page_vector(r.id, r.parts)),
  };
}

// Two tight groups around distinct axes plus one outlier — HDBSCAN forms two
// clusters and rejects the outlier as noise. Group "a" members are placed at the
// window's leading edge (so a cluster touches window_start); group "b" sits
// mid-window. The known project is group "a".
export function two_cluster_window(): WindowInput {
  const rows: { id: string; parts: number[]; at: string }[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push({
      id: `a${i}`,
      parts: [1, 0.02 * i, 0.01 * i, 0],
      at: `2026-03-01T00:00:0${i}.000Z`, // leading edge of a March window
    });
  }
  for (let i = 0; i < 5; i++) {
    rows.push({
      id: `b${i}`,
      parts: [0.01 * i, 1, 0.02 * i, 0],
      at: `2026-03-15T12:0${i}:00.000Z`, // mid-window
    });
  }
  rows.push({ id: "outlier", parts: [0, 0, 0, 1], at: "2026-03-10T06:00:00.000Z" });
  return make_window("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z", rows);
}

export const TWO_CLUSTER_KNOWN_PROJECT = ["a0", "a1", "a2", "a3", "a4"];

// Scattered near-orthogonal vectors: every point sits alone, so HDBSCAN labels
// them all noise (-1). Drives the mean_membership_probability === null /
// noise_fraction === 1 edge cases.
export function all_noise_window(): WindowInput {
  const rows: { id: string; parts: number[]; at: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const parts = new Array(8).fill(0);
    parts[i] = 1; // each on its own basis axis → mutually orthogonal
    rows.push({ id: `n${i}`, parts, at: `2026-05-0${i + 1}T00:00:00.000Z` });
  }
  return make_window("2026-05-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z", rows);
}

// High-dimensional clusters (dim 64 > 50) so reduce_pca50 genuinely reduces. Two
// dense groups separated in the first two coordinates, each with a deterministic
// per-index spread across the remaining dims.
export function high_dim_window(): WindowInput {
  const dim = 64;
  const rows: { id: string; parts: number[]; at: string }[] = [];
  for (let g = 0; g < 2; g++) {
    for (let i = 0; i < 6; i++) {
      const parts = new Array(dim).fill(0);
      parts[g] = 1;
      for (let d = 2; d < dim; d++) parts[d] = 0.01 * ((i + d + g) % 5);
      rows.push({
        id: `g${g}_${i}`,
        parts,
        at: `2026-07-${String(2 + i).padStart(2, "0")}T0${g}:00:00.000Z`,
      });
    }
  }
  return make_window("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z", rows);
}

// A set of windows with varying N, cluster structure, and noise — for
// cross-window variance and the operating-point selection over multiple windows.
export function multi_window_set(): WindowInput[] {
  return [two_cluster_window(), three_cluster_window(), all_noise_window()];
}

function three_cluster_window(): WindowInput {
  const rows: { id: string; parts: number[]; at: string }[] = [];
  const axes = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
  ];
  let day = 2;
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 4; i++) {
      const base = axes[c];
      const parts = [
        base[0] + 0.01 * i,
        base[1] + 0.01 * i,
        base[2] + 0.01 * i,
        0.005 * i,
      ];
      rows.push({
        id: `c${c}_${i}`,
        parts,
        at: `2026-04-${String(day).padStart(2, "0")}T08:00:00.000Z`,
      });
      day++;
    }
  }
  return make_window("2026-04-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z", rows);
}
