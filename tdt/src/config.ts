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

// Page-vector construction knobs (plan §4). Character budgets are deterministic
// proxies for the embedder's token budget: the pure library cannot tokenize, so
// it splits on code-point offsets. Sizes are starting points — re-tuning as the
// chosen embedder changes is a config change, not a code change.
export interface PageVectorConfig {
  lead_chars: number; // title_plus_lead: lead length, in code points
  segment_chars: number; // split content into segments of this many code points
  dispersion_min_mean_cosine: number; // below → multi-topic → represent by dominant segment
  degenerate_norm_epsilon: number; // L2 norm below this → degenerate (fallback, else exclude)
}

// segment_chars ≈ 512 tokens × ~3.2 chars/token (English), rounded down for
// tokenizer headroom; recompute if the embedder's budget/tokenizer changes.
// dispersion_min_mean_cosine = 0.35: passages of one article typically sit at
// 0.5–0.8 mutual cosine for sentence/passage embedders, while unrelated topics
// fall well below; 0.35 is a conservative "genuinely multi-topic" floor and the
// primary knob for the task-36.7 validation sweep.
export const DEFAULT_PAGE_VECTOR_CONFIG = {
  lead_chars: 1000,
  segment_chars: 1600,
  dispersion_min_mean_cosine: 0.35,
  degenerate_norm_epsilon: 1e-6,
} as const satisfies PageVectorConfig;
