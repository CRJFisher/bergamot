import {
  select_operating_point,
  serialize_operating_point,
  parse_operating_point,
  load_operating_point,
  operating_point_path,
  type OperatingPoint,
  type OperatingPointEntry,
} from "./operating_point";
import type { SweepResult, GridCell, WindowScore } from "./types";

function cell(
  min_cluster_size: number,
  min_samples: number,
  epsilon: number,
  reduction: GridCell["reduction"] = "raw",
): GridCell {
  return { min_cluster_size, min_samples, epsilon, method: "eom", reduction };
}

function result(
  c: GridCell,
  mean_membership_probability: number | null,
  mean_noise_fraction: number,
  known_project_recovered: boolean,
): SweepResult {
  const per_window: WindowScore[] = [];
  return {
    cell: c,
    per_window,
    mean_membership_probability,
    mean_noise_fraction,
    median_cluster_size_typical: 4,
    known_project_recovered,
  };
}

describe("select_operating_point", () => {
  it("picks the max mean-probability cell within the healthy noise band", () => {
    const chosen = select_operating_point([
      result(cell(3, 5, 0), 0.7, 0.3, true),
      result(cell(4, 5, 0), 0.9, 0.3, true), // highest probability, healthy
      result(cell(5, 5, 0), 0.95, 0.9, true), // higher prob but noise above ceiling
    ]);
    expect(chosen.min_cluster_size).toBe(4);
  });

  it("enforces known-project recovery as a hard gate", () => {
    const chosen = select_operating_point([
      result(cell(4, 5, 0), 0.95, 0.3, false), // higher prob, but did not recover
      result(cell(3, 5, 0), 0.7, 0.3, true),
    ]);
    expect(chosen.min_cluster_size).toBe(3);
  });

  it("rejects a near-zero-noise (over-merging) cell below the floor", () => {
    const chosen = select_operating_point([
      result(cell(3, 3, 0), 0.99, 0.0, true), // no noise → over-merging
      result(cell(3, 5, 0), 0.8, 0.2, true),
    ]);
    expect(chosen.min_samples).toBe(5);
  });

  it("tie-breaks deterministically by noise then smaller params then reduction", () => {
    const chosen = select_operating_point([
      result(cell(5, 8, 0.2, "pca50"), 0.8, 0.3, true),
      result(cell(3, 5, 0, "raw"), 0.8, 0.3, true), // same prob+noise, smaller params, raw
      result(cell(4, 5, 0, "raw"), 0.8, 0.3, true),
    ]);
    expect(chosen).toEqual({
      min_cluster_size: 3,
      min_samples: 5,
      method: "eom",
      epsilon: 0,
      reduction: "raw",
    });
  });

  it("is independent of input order", () => {
    const cells = [
      result(cell(3, 5, 0), 0.7, 0.3, true),
      result(cell(4, 5, 0), 0.9, 0.3, true),
      result(cell(5, 5, 0), 0.8, 0.3, true),
    ];
    const a = select_operating_point(cells);
    const b = select_operating_point([...cells].reverse());
    expect(a).toEqual(b);
  });

  it("throws when no cell clears the healthy gate", () => {
    expect(() =>
      select_operating_point([result(cell(3, 5, 0), 0.9, 0.95, true)]),
    ).toThrow(/no grid cell met the healthy-noise/);
  });
});

describe("operating-point persistence", () => {
  const point: OperatingPoint = {
    version: 1,
    by_window_unit: {
      month: { min_cluster_size: 3, min_samples: 5, method: "eom", epsilon: 0, reduction: "raw" },
      "14d": { min_cluster_size: 4, min_samples: 5, method: "eom", epsilon: 0.1, reduction: "pca50" },
    },
    selected_at: "2026-06-26T00:00:00.000Z",
    provenance: "test",
  };

  it("round-trips through serialize and parse", () => {
    expect(parse_operating_point(serialize_operating_point(point))).toEqual(point);
  });

  it("rejects a wrong-version file loudly", () => {
    expect(() => parse_operating_point('{"version":2}')).toThrow(/unsupported version/);
  });

  it("rejects an entry with an invalid reduction", () => {
    const bad = JSON.stringify({
      version: 1,
      selected_at: "x",
      provenance: "x",
      by_window_unit: { month: { min_cluster_size: 3, min_samples: 5, method: "eom", epsilon: 0, reduction: "umap" } },
    });
    expect(() => parse_operating_point(bad)).toThrow(/reduction invalid/);
  });

  function with_entry(entry: Record<string, unknown>): string {
    return JSON.stringify({
      version: 1,
      selected_at: "x",
      provenance: "x",
      by_window_unit: { month: entry },
    });
  }
  const base = { min_cluster_size: 3, min_samples: 5, method: "eom", epsilon: 0, reduction: "raw" };

  it("rejects an out-of-domain min_cluster_size (a stale cache-key value)", () => {
    expect(() => parse_operating_point(with_entry({ ...base, min_cluster_size: -3 }))).toThrow(
      /min_cluster_size must be an integer >= 2/,
    );
    expect(() => parse_operating_point(with_entry({ ...base, min_cluster_size: 2.5 }))).toThrow(
      /min_cluster_size must be an integer >= 2/,
    );
  });

  it("rejects a negative epsilon", () => {
    expect(() => parse_operating_point(with_entry({ ...base, epsilon: -0.1 }))).toThrow(
      /epsilon must be a finite number >= 0/,
    );
  });

  it("rejects a non-eom method", () => {
    expect(() => parse_operating_point(with_entry({ ...base, method: "leaf" }))).toThrow(
      /method must be "eom"/,
    );
  });

  it("rejects a missing by_window_unit", () => {
    expect(() => parse_operating_point('{"version":1,"selected_at":"x","provenance":"x"}')).toThrow(
      /missing by_window_unit/,
    );
  });
});

describe("seeded operating_point.json", () => {
  it("loads and exposes the design-default entry for month and 14d", () => {
    const point = load_operating_point(operating_point_path());
    expect(point.version).toBe(1);
    const expected: OperatingPointEntry = {
      min_cluster_size: 3,
      min_samples: 5,
      method: "eom",
      epsilon: 0,
      reduction: "raw",
    };
    expect(point.by_window_unit.month).toEqual(expected);
    expect(point.by_window_unit["14d"]).toEqual(expected);
  });
});
