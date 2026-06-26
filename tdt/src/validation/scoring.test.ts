import {
  score_cell,
  boundary_fragmentation_count,
  cross_window_variance,
  visits_per_month,
  aggregate_sweep,
} from "./scoring";
import type { HdbscanRaw, RepresentedCluster, VisitRow } from "../types";
import type { CellScore, WindowScore, GridCell } from "./types";

function raw(labels: number[], probabilities: number[]): HdbscanRaw {
  return { labels, probabilities, exemplar_indices: new Map() };
}

function cluster(start: string, end: string): RepresentedCluster {
  return {
    local_label: 0,
    member_indices: [0],
    representative_index: 0,
    representative_vector: new Float32Array([1]),
    size: 1,
    time_span: { start, end },
  };
}

const CELL: GridCell = {
  min_cluster_size: 3,
  min_samples: 5,
  epsilon: 0,
  method: "eom",
  reduction: "raw",
};

function window_score(
  score: CellScore,
  recovered: boolean,
): WindowScore {
  return {
    window_start: "2026-03-01T00:00:00.000Z",
    window_end: "2026-04-01T00:00:00.000Z",
    cell: CELL,
    score,
    boundary_fragmentation: 0,
    known_project_recovered: recovered,
  };
}

describe("score_cell", () => {
  it("computes noise_fraction as the share of label -1", () => {
    const s = score_cell(raw([0, 0, 0, -1], [0.9, 0.8, 0.7, 0]));
    expect(s.n).toBe(4);
    expect(s.noise_fraction).toBeCloseTo(0.25, 10);
  });

  it("averages membership probability over non-noise points only, excluding -1", () => {
    const s = score_cell(raw([0, 0, -1], [0.6, 0.8, 0.0]));
    // (0.6 + 0.8) / 2 — the -1 point's 0 probability is excluded.
    expect(s.mean_membership_probability).toBeCloseTo(0.7, 10);
  });

  it("returns null aggregates and noise_fraction 1 for an all-noise window", () => {
    const s = score_cell(raw([-1, -1, -1], [0, 0, 0]));
    expect(s.noise_fraction).toBe(1);
    expect(s.mean_membership_probability).toBeNull();
    expect(s.median_cluster_size).toBeNull();
    expect(s.cluster_count).toBe(0);
  });

  it("returns 0 noise and null aggregates for an empty window", () => {
    const s = score_cell(raw([], []));
    expect(s.n).toBe(0);
    expect(s.noise_fraction).toBe(0);
    expect(s.mean_membership_probability).toBeNull();
    expect(s.median_cluster_size).toBeNull();
  });

  it("computes median cluster size across an odd number of clusters", () => {
    // sizes: label0=1, label1=3, label2=2 → sorted [1,2,3] → 2
    const s = score_cell(
      raw([0, 1, 1, 1, 2, 2], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    );
    expect(s.cluster_count).toBe(3);
    expect(s.median_cluster_size).toBe(2);
  });

  it("averages the two middles for an even number of clusters", () => {
    // sizes: label0=1, label1=4 → [1,4] → 2.5
    const s = score_cell(
      raw([0, 1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5, 0.5]),
    );
    expect(s.median_cluster_size).toBe(2.5);
  });
});

describe("boundary_fragmentation_count", () => {
  const ws = "2026-03-01T00:00:00.000Z";
  const we = "2026-04-01T00:00:00.000Z";

  it("counts a cluster whose span starts at the window start", () => {
    const c = cluster("2026-03-01T00:00:00.000Z", "2026-03-10T00:00:00.000Z");
    expect(boundary_fragmentation_count([c], ws, we)).toBe(1);
  });

  it("counts a cluster whose latest member is within tolerance of the exclusive end", () => {
    const c = cluster("2026-03-20T00:00:00.000Z", "2026-03-31T23:59:59.500Z");
    expect(boundary_fragmentation_count([c], ws, we)).toBe(1);
  });

  it("does not count a fully interior cluster", () => {
    const c = cluster("2026-03-10T00:00:00.000Z", "2026-03-20T00:00:00.000Z");
    expect(boundary_fragmentation_count([c], ws, we)).toBe(0);
  });

  it("parses ISO instants, not raw strings, across mixed offset forms", () => {
    // +00:00 form for the window start; the cluster touches it despite the
    // different spelling that would break a lexical compare.
    const c = cluster("2026-03-01T00:00:00.000Z", "2026-03-05T00:00:00.000Z");
    expect(boundary_fragmentation_count([c], "2026-03-01T00:00:00+00:00", we)).toBe(1);
  });
});

describe("cross_window_variance", () => {
  function cs(n: number, cluster_count: number, noise_fraction: number): CellScore {
    return {
      n,
      cluster_count,
      noise_fraction,
      mean_membership_probability: null,
      median_cluster_size: null,
    };
  }

  it("reports population mean, variance, min, max, count for each series", () => {
    const v = cross_window_variance([cs(10, 2, 0.2), cs(20, 4, 0.4)]);
    expect(v.n.mean).toBe(15);
    expect(v.n.min).toBe(10);
    expect(v.n.max).toBe(20);
    expect(v.n.count).toBe(2);
    // population variance of [10,20] around 15 = (25+25)/2 = 25
    expect(v.n.variance).toBe(25);
    expect(v.cluster_count.variance).toBe(1);
    expect(v.noise_fraction.mean).toBeCloseTo(0.3, 10);
  });

  it("returns zero-count stats for empty input", () => {
    const v = cross_window_variance([]);
    expect(v.n).toEqual({ mean: 0, variance: 0, min: 0, max: 0, count: 0 });
  });
});

describe("visits_per_month", () => {
  function visit(at: string): VisitRow {
    return {
      page_session_id: at,
      url: "https://example.com",
      title: null,
      site_name: null,
      page_loaded_at: at,
      tree_id: "t",
    };
  }

  it("buckets by UTC calendar month and sorts ascending", () => {
    const out = visits_per_month([
      visit("2026-03-15T00:00:00.000Z"),
      visit("2026-01-02T00:00:00.000Z"),
      visit("2026-03-20T00:00:00.000Z"),
    ]);
    expect(out).toEqual([
      { month: "2026-01", visits: 1 },
      { month: "2026-03", visits: 2 },
    ]);
  });
});

describe("aggregate_sweep", () => {
  it("ignores null per-window probabilities and flags recovery on a plurality", () => {
    const agg = aggregate_sweep([
      window_score(
        { n: 5, cluster_count: 1, noise_fraction: 0.2, mean_membership_probability: 0.8, median_cluster_size: 4 },
        true,
      ),
      window_score(
        { n: 4, cluster_count: 0, noise_fraction: 1, mean_membership_probability: null, median_cluster_size: null },
        false,
      ),
    ]);
    expect(agg.mean_membership_probability).toBeCloseTo(0.8, 10); // null ignored
    expect(agg.mean_noise_fraction).toBeCloseTo(0.6, 10);
    expect(agg.median_cluster_size_typical).toBe(4);
    expect(agg.known_project_recovered).toBe(false); // 1 of 2 is not > half
  });

  it("flags recovery when strictly more than half the windows recover", () => {
    const s: CellScore = {
      n: 5, cluster_count: 1, noise_fraction: 0.2, mean_membership_probability: 0.8, median_cluster_size: 4,
    };
    const agg = aggregate_sweep([
      window_score(s, true),
      window_score(s, true),
      window_score(s, false),
    ]);
    expect(agg.known_project_recovered).toBe(true);
  });
});
