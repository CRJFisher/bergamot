import { represent_clusters } from "./representations";
import type { HdbscanRaw, PageVector, VisitRow } from "./types";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function l2_normalize(parts: number[]): Float32Array {
  let norm = 0;
  for (const x of parts) norm += x * x;
  norm = Math.sqrt(norm);
  return Float32Array.from(parts, (x) => x / norm);
}

// An UN-normalized page vector, so a test can prove the representative vector is
// L2-normalized by construction rather than by the inputs already being unit.
function raw_vector(id: string, parts: number[]): PageVector {
  return { page_session_id: id, vector: Float32Array.from(parts), low_confidence: false };
}

function unit_vector(id: string, parts: number[]): PageVector {
  return { page_session_id: id, vector: l2_normalize(parts), low_confidence: false };
}

function t(y: number, mo: number, d: number, h = 0, min = 0): string {
  return new Date(Date.UTC(y, mo - 1, d, h, min, 0)).toISOString();
}

function visit(id: string, url: string, page_loaded_at: string): VisitRow {
  return { page_session_id: id, url, title: null, site_name: null, page_loaded_at, tree_id: "t1" };
}

function make_raw(
  labels: number[],
  probabilities: number[],
  exemplars: [number, number][],
): HdbscanRaw {
  return { labels, probabilities, exemplar_indices: new Map(exemplars) };
}

function bytes(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
function bytes_equal(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && bytes(a).equals(bytes(b));
}
function l2(v: Float32Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

// ---------------------------------------------------------------------------
// Representative selection (AC#1)
// ---------------------------------------------------------------------------

describe("represent_clusters — representative selection (AC#1)", () => {
  it("uses the eom exemplar index as the representative when present (AC#1)", async () => {
    const vectors = [
      unit_vector("a0", [1, 0, 0]),
      unit_vector("a1", [1, 0.05, 0]),
      unit_vector("a2", [1, 0.02, 0]),
    ];
    const visits = [
      visit("a0", "https://x.com/0", t(2024, 1, 1)),
      visit("a1", "https://x.com/1", t(2024, 1, 2)),
      visit("a2", "https://x.com/2", t(2024, 1, 3)),
    ];
    const raw = make_raw([0, 0, 0], [0.9, 0.8, 0.7], [[0, 1]]);

    const result = await represent_clusters(raw, vectors, visits);
    expect(result).toHaveLength(1);
    expect(result[0].representative_index).toBe(1);
  });

  it("falls back to the cosine-medoid member when the cluster has no exemplar (AC#1)", async () => {
    // a1 sits between a0 and a2 on the same axis → it is the cosine-medoid (the
    // member with minimal summed cosine distance), so the select_medoids branch
    // must pick index 1 with an empty exemplar map.
    const vectors = [
      unit_vector("a0", [1, 0, 0]),
      unit_vector("a1", [1, 0.05, 0]),
      unit_vector("a2", [1, 0.1, 0]),
    ];
    const visits = [
      visit("a0", "https://x.com/0", t(2024, 1, 1)),
      visit("a1", "https://x.com/1", t(2024, 1, 2)),
      visit("a2", "https://x.com/2", t(2024, 1, 3)),
    ];
    const raw = make_raw([0, 0, 0], [0.9, 0.8, 0.7], []);

    const result = await represent_clusters(raw, vectors, visits);
    expect(result[0].representative_index).toBe(1);
  });

  it("falls back to medoid only for the cluster missing an exemplar, keeping the rest (AC#1)", async () => {
    const vectors = [
      unit_vector("a0", [1, 0, 0]),
      unit_vector("a1", [1, 0.05, 0]),
      unit_vector("a2", [1, 0.1, 0]),
      unit_vector("b0", [0, 1, 0]),
      unit_vector("b1", [0, 1, 0.05]),
      unit_vector("b2", [0, 1, 0.1]),
    ];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    // cluster 0 has an exemplar (index 2); cluster 1 does not → medoid for b* is b1 (index 4).
    const raw = make_raw([0, 0, 0, 1, 1, 1], [0.9, 0.8, 0.7, 0.9, 0.8, 0.7], [[0, 2]]);

    const result = await represent_clusters(raw, vectors, visits);
    expect(result.map((c) => c.representative_index)).toEqual([2, 4]);
  });

  it("resolves every representative_index into the input row range (AC#1)", async () => {
    const vectors = [unit_vector("a0", [1, 0, 0]), unit_vector("a1", [1, 0.05, 0]), unit_vector("a2", [1, 0.1, 0])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, 0], [0.9, 0.8, 0.7], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    for (const c of result) {
      expect(c.representative_index).toBeGreaterThanOrEqual(0);
      expect(c.representative_index).toBeLessThan(vectors.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Noise has no representative (AC#1)
// ---------------------------------------------------------------------------

describe("represent_clusters — noise has no representative (AC#1)", () => {
  function one_cluster_plus_noise(): {
    raw: HdbscanRaw;
    vectors: PageVector[];
    visits: VisitRow[];
  } {
    const vectors = [
      unit_vector("a0", [1, 0, 0]),
      unit_vector("a1", [1, 0.05, 0]),
      unit_vector("a2", [1, 0.1, 0]),
      unit_vector("n0", [0, 0, 1]),
      unit_vector("n1", [0, 1, 0]),
    ];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, 0, -1, -1], [0.9, 0.8, 0.7, 0, 0], [[0, 0]]);
    return { raw, vectors, visits };
  }

  it("emits exactly one cluster for a window with one cluster plus noise (AC#1)", async () => {
    const { raw, vectors, visits } = one_cluster_plus_noise();
    const result = await represent_clusters(raw, vectors, visits);
    expect(result).toHaveLength(1);
  });

  it("excludes every noise row from member_indices (AC#1)", async () => {
    const { raw, vectors, visits } = one_cluster_plus_noise();
    const result = await represent_clusters(raw, vectors, visits);
    expect(result[0].member_indices).toEqual([0, 1, 2]);
  });

  it("produces no cluster for an all-noise window (AC#1)", async () => {
    const vectors = [unit_vector("n0", [1, 0, 0]), unit_vector("n1", [0, 1, 0]), unit_vector("n2", [0, 0, 1])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([-1, -1, -1], [0, 0, 0], []);

    const result = await represent_clusters(raw, vectors, visits);
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty window (AC#1)", async () => {
    const result = await represent_clusters(make_raw([], [], []), [], []);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frozen representative vector (AC#1)
// ---------------------------------------------------------------------------

describe("represent_clusters — frozen representative vector (AC#1)", () => {
  it("is the L2-normalized mean of the member vectors (AC#1)", async () => {
    const vectors = [raw_vector("a0", [2, 0, 0]), raw_vector("a1", [0, 2, 0]), raw_vector("a2", [2, 2, 0])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, 0], [0.9, 0.8, 0.7], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    // mean = [4/3, 4/3, 0]; normalized → [1/√2, 1/√2, 0].
    const v = result[0].representative_vector;
    expect(v[0]).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(v[1]).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(v[2]).toBeCloseTo(0, 6);
  });

  it("is unit-norm for every cluster (AC#1)", async () => {
    const vectors = [raw_vector("a0", [3, 1, 0]), raw_vector("a1", [1, 3, 0]), raw_vector("a2", [2, 2, 1])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, 0], [0.9, 0.8, 0.7], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    expect(l2(result[0].representative_vector)).toBeCloseTo(1, 6);
  });

  it("does not alias any input member vector (AC#1)", async () => {
    const vectors = [raw_vector("a0", [2, 0, 0]), raw_vector("a1", [0, 2, 0]), raw_vector("a2", [2, 2, 0])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, 0], [0.9, 0.8, 0.7], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    const before = result[0].representative_vector[0];
    vectors[0].vector[0] = 999; // mutate an input after the call
    expect(result[0].representative_vector[0]).toBe(before);
  });

  it("computes the mean from member rows only, ignoring noise rows (AC#1)", async () => {
    const vectors = [raw_vector("a0", [2, 0, 0]), raw_vector("a1", [0, 2, 0]), raw_vector("n0", [0, 0, 9])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, -1], [0.9, 0.8, 0], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    // The on-axis-3 noise row must not pull the representative off the xy-plane.
    expect(result[0].representative_vector[2]).toBeCloseTo(0, 6);
  });

  it("falls back to the representative member's unit vector when the mean collapses (AC#1)", async () => {
    // Near-antipodal members → mean norm ≈ 0; the frozen vector must be a valid
    // unit vector (the representative member's), never a near-zero direction.
    const vectors = [unit_vector("a0", [1, 0, 0]), unit_vector("a1", [-1, 0, 0])];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0], [0.9, 0.8], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    expect(l2(result[0].representative_vector)).toBeCloseTo(1, 6);
    expect(bytes_equal(result[0].representative_vector, vectors[0].vector)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism (AC#1)
// ---------------------------------------------------------------------------

describe("represent_clusters — determinism (AC#1)", () => {
  it("yields a byte-identical representative vector on repeated calls (AC#1)", async () => {
    const build = () => {
      const vectors = [raw_vector("a0", [3, 1, 0]), raw_vector("a1", [1, 3, 0]), raw_vector("a2", [2, 2, 1])];
      const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
      return { vectors, visits, raw: make_raw([0, 0, 0], [0.9, 0.8, 0.7], [[0, 0]]) };
    };
    const a = build();
    const b = build();
    const ra = await represent_clusters(a.raw, a.vectors, a.visits);
    const rb = await represent_clusters(b.raw, b.vectors, b.visits);
    expect(bytes_equal(ra[0].representative_vector, rb[0].representative_vector)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Metadata (AC#1)
// ---------------------------------------------------------------------------

describe("represent_clusters — metadata (AC#1)", () => {
  it("sets size to the member count and local_label to the HDBSCAN label", async () => {
    const vectors = [
      unit_vector("a0", [1, 0, 0]), unit_vector("a1", [1, 0.05, 0]), unit_vector("a2", [1, 0.1, 0]),
      unit_vector("b0", [0, 1, 0]), unit_vector("b1", [0, 1, 0.05]), unit_vector("b2", [0, 1, 0.1]),
    ];
    const visits = vectors.map((v, i) => visit(v.page_session_id, `https://x.com/${i}`, t(2024, 1, i + 1)));
    const raw = make_raw([0, 0, 0, 1, 1, 1], [0.9, 0.8, 0.7, 0.9, 0.8, 0.7], [[0, 0], [1, 3]]);

    const result = await represent_clusters(raw, vectors, visits);
    expect(result.map((c) => c.local_label)).toEqual([0, 1]);
    expect(result.map((c) => c.size)).toEqual([3, 3]);
  });

  it("derives time_span from member visits (start=min, end=max), excluding noise", async () => {
    const vectors = [unit_vector("a0", [1, 0, 0]), unit_vector("a1", [1, 0.05, 0]), unit_vector("a2", [1, 0.1, 0]), unit_vector("n0", [0, 0, 1])];
    const visits = [
      visit("a0", "https://x.com/0", t(2024, 3, 10)),
      visit("a1", "https://x.com/1", t(2024, 3, 1)), // earliest member
      visit("a2", "https://x.com/2", t(2024, 3, 20)), // latest member
      visit("n0", "https://x.com/n", t(2024, 3, 31)), // noise — must NOT widen the span
    ];
    const raw = make_raw([0, 0, 0, -1], [0.9, 0.8, 0.7, 0], [[0, 0]]);

    const result = await represent_clusters(raw, vectors, visits);
    expect(result[0].time_span).toEqual({ start: t(2024, 3, 1), end: t(2024, 3, 20) });
  });
});

// ---------------------------------------------------------------------------
// Index-alignment guards
// ---------------------------------------------------------------------------

describe("represent_clusters — index alignment guards", () => {
  it("throws when vectors and visits lengths differ", async () => {
    const vectors = [unit_vector("a0", [1, 0]), unit_vector("a1", [0, 1]), unit_vector("a2", [1, 1])];
    const visits = [visit("a0", "https://x.com/0", t(2024, 1, 1)), visit("a1", "https://x.com/1", t(2024, 1, 2))];
    await expect(represent_clusters(make_raw([0, 0, 0], [1, 1, 1], []), vectors, visits)).rejects.toThrow(/misaligned/);
  });

  it("throws when labels and vectors lengths differ", async () => {
    const vectors = [unit_vector("a0", [1, 0]), unit_vector("a1", [0, 1])];
    const visits = [visit("a0", "https://x.com/0", t(2024, 1, 1)), visit("a1", "https://x.com/1", t(2024, 1, 2))];
    await expect(represent_clusters(make_raw([0, 0, 0], [1, 1, 1], []), vectors, visits)).rejects.toThrow(/misaligned/);
  });

  it("throws when a row's vector and visit page_session_id disagree (mis-zip)", async () => {
    const vectors = [unit_vector("a0", [1, 0]), unit_vector("a1", [0, 1])];
    const visits = [visit("a0", "https://x.com/0", t(2024, 1, 1)), visit("SWAPPED", "https://x.com/1", t(2024, 1, 2))];
    await expect(represent_clusters(make_raw([0, 0], [1, 1], [[0, 0]]), vectors, visits)).rejects.toThrow(/mis-zipped/);
  });
});
