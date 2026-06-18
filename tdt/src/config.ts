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

/**
 * Window-default scale check (plan §5, "Empirical prerequisite").
 * Run against the live DuckDB to confirm a typical month stays well under
 * max_samples; if it routinely exceeds it, tighten `unit` to "days" with
 * `days: 14`. The DB is encrypted at rest and held read-write by the extension —
 * run through the HTTP broker, not a direct CLI connection:
 *
 *   SELECT date_trunc('month', CAST(page_loaded_at AS TIMESTAMP)) AS wk,
 *          count(*) AS visits
 *   FROM webpage_activity_sessions
 *   GROUP BY 1 ORDER BY 2 DESC LIMIT 24;
 *
 * Decision recorded in TASK-36.2 Implementation Notes (AC #1).
 */
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
