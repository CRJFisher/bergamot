/**
 * Type-only seam for the future LLM cluster namer (plan §7 "LLM naming", AC#4).
 *
 * No runtime values and no config flag live here: a default-off flag now would
 * be dead config, so the flag lands with the implementation. The cache table is
 * likewise deferred — it needs a stable cluster identity that does not yet exist
 * (HDBSCAN is fit-only; local_label is run-local). The cache and a stable
 * lifeline identity arrive with the Phase-4 tracking slice, where the displayed
 * label is derived at the tracked-lifeline level so Phase-4 does not inherit
 * per-window label churn.
 */

import type { ClusterLabel } from "../types";

/**
 * A shared return contract (a display string the UI shows) so the deterministic
 * path and the later LLM path are interchangeable. The implementation — an async
 * call to a gated, cached LLM port — lands with its own config flag.
 */
export interface ClusterNamer {
  name_cluster(label: ClusterLabel, fingerprint: ClusterFingerprint): Promise<string>;
}

/**
 * A geometric + stable-core cache key, deliberately NOT an exemplar-id hash: a
 * single exemplar flips on tiny changes (over-firing) and hub pages collide
 * (under-firing). The rewrite re-fires only when the representative vector moves
 * beyond a cosine threshold, OR the stable core's Jaccard overlap drops below
 * ~0.8 — reusing the representative-vector + cosine machinery the Phase-4
 * tracker uses, so there is one mechanism, not two.
 */
export interface ClusterFingerprint {
  representative_vector: Float32Array;
  /**
   * page_session_ids of members whose membership probability is above a cutoff
   * (excluding noise and low-probability fringe), sorted so the Jaccard overlap
   * between two runs is a stable comparison.
   */
  stable_core: string[];
}
