// Standalone leaf module: imports nothing.
// Defaults are starting points for the validation sweep (plan §11);
// re-tuning as history grows is a data change, not a code change.

export interface WindowConfig {
  unit: "month" | "days";
  days?: number; // when unit === 'days'
  tz: "UTC";
  max_samples: number; // hard count guard; headroom under ~5k for the dense (n,n) matrix
  subdivide_order: ("gap" | "half_month" | "iso_week")[];
  min_window_visits: number; // windows below this threshold are skipped as too sparse
}

export const DEFAULT_WINDOW_CONFIG = {
  unit: "month",
  tz: "UTC",
  max_samples: 4000,
  subdivide_order: ["gap", "half_month", "iso_week"],
  min_window_visits: 8,
} as const satisfies WindowConfig;

export interface HdbscanConfig {
  min_cluster_size: number; // 3 pages: a 3-page thread is a real personal-scale project
  min_samples: number; // DECOUPLED from min_cluster_size; preserves honest noise rejection
  method: "eom" | "leaf"; // 'eom': stable clusters + defined exemplars (needed for representatives)
  epsilon: number; // clusterSelectionEpsilon, cosine-distance units
}

export const DEFAULT_HDBSCAN_CONFIG = {
  min_cluster_size: 3,
  min_samples: 5,
  method: "eom",
  epsilon: 0.0,
} as const satisfies HdbscanConfig;
