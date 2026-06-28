import {
  operating_point_key,
  resolve_hdbscan_config,
} from "./operating_config";
import {
  DEFAULT_WINDOW_CONFIG,
  DEFAULT_HDBSCAN_CONFIG,
  type OperatingPoint,
  type WindowConfig,
} from "@bergamot/tdt";

function point(overrides: Partial<OperatingPoint["by_window_unit"]>): OperatingPoint {
  return {
    version: 1,
    by_window_unit: {
      month: {
        min_cluster_size: 4,
        min_samples: 7,
        method: "eom",
        epsilon: 0.1,
        reduction: "raw",
      },
      ...overrides,
    },
    selected_at: "2026-06-26T00:00:00.000Z",
    provenance: "test",
  };
}

describe("operating_point_key", () => {
  it("is 'month' for a month window", () => {
    expect(operating_point_key(DEFAULT_WINDOW_CONFIG)).toBe("month");
  });

  it("is '<days>d' for a day-stride window", () => {
    const cfg: WindowConfig = { ...DEFAULT_WINDOW_CONFIG, unit: "days", days: 14 };
    expect(operating_point_key(cfg)).toBe("14d");
  });
});

describe("resolve_hdbscan_config", () => {
  it("reflects the sweep-selected operating point, not the grid default (AC#5)", () => {
    const resolved = resolve_hdbscan_config(
      DEFAULT_WINDOW_CONFIG,
      DEFAULT_HDBSCAN_CONFIG,
      () => point({}),
    );
    expect(resolved).toEqual({
      min_cluster_size: 4,
      min_samples: 7,
      method: "eom",
      epsilon: 0.1,
    });
    expect(resolved).not.toEqual(DEFAULT_HDBSCAN_CONFIG);
  });

  it("resolves a tuned day-stride entry by its '<days>d' key", () => {
    const resolved = resolve_hdbscan_config(
      { ...DEFAULT_WINDOW_CONFIG, unit: "days", days: 14 },
      DEFAULT_HDBSCAN_CONFIG,
      () =>
        point({
          "14d": {
            min_cluster_size: 6,
            min_samples: 3,
            method: "eom",
            epsilon: 0.2,
            reduction: "raw",
          },
        }),
    );
    expect(resolved).toEqual({
      min_cluster_size: 6,
      min_samples: 3,
      method: "eom",
      epsilon: 0.2,
    });
  });

  it("falls back to the grid default when no entry is tuned for the unit", () => {
    const resolved = resolve_hdbscan_config(
      { ...DEFAULT_WINDOW_CONFIG, unit: "days", days: 30 },
      DEFAULT_HDBSCAN_CONFIG,
      () => point({}), // only a 'month' entry exists; no '30d'
    );
    expect(resolved).toEqual(DEFAULT_HDBSCAN_CONFIG);
  });

  it("fails loud when the tuned entry selects a non-raw reduction (raw production path)", () => {
    expect(() =>
      resolve_hdbscan_config(DEFAULT_WINDOW_CONFIG, DEFAULT_HDBSCAN_CONFIG, () =>
        point({
          month: {
            min_cluster_size: 4,
            min_samples: 7,
            method: "eom",
            epsilon: 0.1,
            reduction: "pca50",
          },
        }),
      ),
    ).toThrow(/reduction="pca50"/);
  });

  it("the checked-in operating_point.json resolves without throwing (default load)", () => {
    const resolved = resolve_hdbscan_config(
      DEFAULT_WINDOW_CONFIG,
      DEFAULT_HDBSCAN_CONFIG,
    );
    expect(resolved.method).toBe("eom");
    expect(Number.isInteger(resolved.min_cluster_size)).toBe(true);
  });
});
