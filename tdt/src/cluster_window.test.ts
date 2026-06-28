import {
  build_cosine_distance_matrix,
  cluster_window,
  resolve_algo_version,
  require_hdbscan,
} from "./cluster_window";
import { DEFAULT_HDBSCAN_CONFIG } from "./config";
import type { PageVector } from "./types";
import { HDBSCAN } from "clustering-tfjs";
import * as tf_core from "@tensorflow/tfjs-core";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function l2_normalize(parts: number[]): Float32Array {
  let norm = 0;
  for (const x of parts) norm += x * x;
  norm = Math.sqrt(norm);
  return Float32Array.from(parts, (x) => x / norm);
}

function page_vector(id: string, parts: number[]): PageVector {
  return { page_session_id: id, vector: l2_normalize(parts), low_confidence: false };
}

// A fixture window: two tight groups around distinct axes plus one outlier on a
// third axis. The deterministic per-index perturbation (no RNG) keeps members
// near-collinear without being identical, so HDBSCAN forms two clusters and
// rejects the lone outlier as noise (-1).
function fixture_window(): PageVector[] {
  const vectors: PageVector[] = [];
  for (let i = 0; i < 5; i++) {
    vectors.push(page_vector(`a${i}`, [1, 0.02 * i, 0.01 * i, 0]));
  }
  for (let i = 0; i < 5; i++) {
    vectors.push(page_vector(`b${i}`, [0.01 * i, 1, 0.02 * i, 0]));
  }
  vectors.push(page_vector("outlier", [0, 0, 0, 1]));
  return vectors;
}

const MAX_SAMPLES = 4000;

// ---------------------------------------------------------------------------
// build_cosine_distance_matrix (AC#1, AC#3)
// ---------------------------------------------------------------------------

describe("build_cosine_distance_matrix", () => {
  it("is dense (n,n) with a zero diagonal, symmetric, clamped to [0,2]", () => {
    const vectors = fixture_window();
    const n = vectors.length;
    const D = build_cosine_distance_matrix(vectors, MAX_SAMPLES);

    expect(D).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      expect(D[i]).toHaveLength(n);
      expect(D[i][i]).toBe(0);
      for (let j = 0; j < n; j++) {
        expect(D[i][j]).toBe(D[j][i]);
        expect(D[i][j]).toBeGreaterThanOrEqual(0);
        expect(D[i][j]).toBeLessThanOrEqual(2);
      }
    }
  });

  it("maps identical, orthogonal, and opposite vectors to 0, 1, 2", () => {
    const vectors = [
      page_vector("x", [1, 0]),
      page_vector("x_copy", [1, 0]),
      page_vector("y", [0, 1]),
      page_vector("neg_x", [-1, 0]),
    ];
    const D = build_cosine_distance_matrix(vectors, MAX_SAMPLES);
    expect(D[0][1]).toBeCloseTo(0, 6); // identical direction
    expect(D[0][2]).toBeCloseTo(1, 6); // orthogonal
    expect(D[0][3]).toBeCloseTo(2, 6); // opposite
  });

  it("rejects an oversized window before allocating the dense matrix (AC#3)", () => {
    const vectors = [page_vector("a", [1, 0]), page_vector("b", [0, 1]), page_vector("c", [1, 1])];
    expect(() => build_cosine_distance_matrix(vectors, 2)).toThrow(/exceeds max_samples=2/);
  });

  it("rejects a ragged window with a dimension mismatch", () => {
    const vectors = [page_vector("a", [1, 0]), page_vector("ragged", [1, 0, 0])];
    expect(() => build_cosine_distance_matrix(vectors, MAX_SAMPLES)).toThrow(
      /page ragged has dimension 3, expected 2/,
    );
  });

  it("returns an empty matrix for an empty window", () => {
    expect(build_cosine_distance_matrix([], MAX_SAMPLES)).toEqual([]);
  });

  it("returns a 1x1 zero matrix for a single-page window", () => {
    expect(build_cosine_distance_matrix([page_vector("solo", [1, 0])], MAX_SAMPLES)).toEqual([[0]]);
  });
});

// ---------------------------------------------------------------------------
// cluster_window — the isolated HDBSCAN call (AC#2, AC#6)
// ---------------------------------------------------------------------------

describe("cluster_window", () => {
  it("emits decoupled clusters, honest -1 noise, probabilities and exemplars (AC#2)", async () => {
    const vectors = fixture_window();
    const raw = await cluster_window(vectors, DEFAULT_HDBSCAN_CONFIG, MAX_SAMPLES);

    expect(raw.labels).toHaveLength(vectors.length);
    expect(raw.probabilities).toHaveLength(vectors.length);

    const cluster_labels = new Set(raw.labels.filter((l) => l >= 0));
    expect(cluster_labels.size).toBeGreaterThanOrEqual(2);

    const outlier_index = vectors.findIndex((v) => v.page_session_id === "outlier");
    expect(raw.labels[outlier_index]).toBe(-1);

    raw.labels.forEach((label, i) => {
      const p = raw.probabilities[i];
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      if (label === -1) expect(p).toBe(0); // noise carries zero membership
    });

    // eom + store_exemplars => one representative row index per cluster.
    expect(raw.exemplar_indices.size).toBe(cluster_labels.size);
    for (const row of raw.exemplar_indices.values()) {
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(vectors.length);
    }
  });

  it("returns an empty result for an empty window", async () => {
    const raw = await cluster_window([], DEFAULT_HDBSCAN_CONFIG, MAX_SAMPLES);
    expect(raw.labels).toEqual([]);
    expect(raw.probabilities).toEqual([]);
    expect(raw.exemplar_indices.size).toBe(0);
  });

  it("clustering the same window twice yields identical labels and probabilities (AC#4)", async () => {
    const first = await cluster_window(fixture_window(), DEFAULT_HDBSCAN_CONFIG, MAX_SAMPLES);
    const second = await cluster_window(fixture_window(), DEFAULT_HDBSCAN_CONFIG, MAX_SAMPLES);

    expect(JSON.stringify(second.labels)).toBe(JSON.stringify(first.labels));
    expect(JSON.stringify(second.probabilities)).toBe(JSON.stringify(first.probabilities));
    expect([...second.exemplar_indices.entries()]).toEqual([...first.exemplar_indices.entries()]);
  });
});

// ---------------------------------------------------------------------------
// resolve_algo_version (AC#5)
// ---------------------------------------------------------------------------

describe("resolve_algo_version", () => {
  it("records the clustering-tfjs version and the active backend", async () => {
    // Run a fit first so a backend is loaded and active.
    await cluster_window(fixture_window(), DEFAULT_HDBSCAN_CONFIG, MAX_SAMPLES);
    const algo_version = resolve_algo_version();
    expect(algo_version).toMatch(/^hdbscan-1#clustering-tfjs@\d+\.\d+\.\d+#.+$/);
    // The recorded backend is the one actually active, not a placeholder.
    expect(algo_version.endsWith(`#${tf_core.getBackend()}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dependency-absence guards (AC#6)
// ---------------------------------------------------------------------------

describe("dependency guards", () => {
  it("require_hdbscan fails clearly when the HDBSCAN export is absent (AC#6)", () => {
    expect(() => require_hdbscan(undefined)).toThrow(/clustering-tfjs HDBSCAN is unavailable/);
    expect(require_hdbscan(HDBSCAN)).toBe(HDBSCAN);
  });
});
