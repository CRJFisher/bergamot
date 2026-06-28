/**
 * Resolves the sweep-selected operating point (TASK-36.7, `operating_point.json`)
 * into the `HdbscanConfig` the production clustering run uses (AC#5, plan §6).
 * Operating parameters are config DATA selected by the validation sweep and keyed
 * by window size — never hardcoded — so this is the seam that makes the shipped
 * clustering reflect that data file rather than the grid's compile-time defaults.
 */
import {
  load_operating_point,
  type HdbscanConfig,
  type WindowConfig,
  type OperatingPoint,
} from "@bergamot/tdt";

/** The `operating_point.json` key for a window config: "month", else "<days>d". */
export function operating_point_key(window_config: WindowConfig): string {
  return window_config.unit === "month" ? "month" : `${window_config.days}d`;
}

/**
 * The HDBSCAN config the production run uses for `window_config`: the operating
 * point tuned for this window unit, falling back to `fallback` (the grid default)
 * only when no point is tuned for the unit yet. The `load` indirection lets tests
 * inject a fixture instead of the package's checked-in file.
 *
 * @throws when the tuned entry selects a `reduction` other than "raw" — the
 *   production `compute_clusters` path clusters RAW page vectors, so params tuned
 *   for a PCA-reduced space cannot be applied faithfully. Fail loud rather than
 *   silently cluster raw vectors with reduced-space parameters.
 */
export function resolve_hdbscan_config(
  window_config: WindowConfig,
  fallback: HdbscanConfig,
  load: () => OperatingPoint = load_operating_point,
): HdbscanConfig {
  const key = operating_point_key(window_config);
  const entry = load().by_window_unit[key];
  if (!entry) return fallback;
  if (entry.reduction !== "raw") {
    throw new Error(
      `operating_point.json entry "${key}" selects reduction="${entry.reduction}", ` +
        `but the production clustering path embeds raw page vectors. Wire PCA ` +
        `reduction into compute_clusters before selecting a reduced operating point.`,
    );
  }
  return {
    min_cluster_size: entry.min_cluster_size,
    min_samples: entry.min_samples,
    method: entry.method,
    epsilon: entry.epsilon,
  };
}
