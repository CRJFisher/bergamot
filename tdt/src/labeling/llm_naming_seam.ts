/**
 * SEAM ONLY — documented, not implemented (plan §7 "LLM naming", AC#4).
 *
 * This file fixes the interface boundary and the cache-key TYPES for the future
 * LLM cluster namer so that landing it later is a drop-in, not a refactor.
 * Nothing here is executable: there are no functions, no runtime values, and —
 * deliberately — NO config flag. A default-off flag now would be dead config;
 * the flag is introduced WITH the implementation when it lands.
 *
 * When built, the namer is a pure REWRITE step: it consumes the deterministic
 * ClusterLabel bundle (this slice's output) plus the geometric fingerprint below
 * and returns ONE clean display phrase, cached on the fingerprint. The cache
 * TABLE is not created now either — it needs a stable cluster identity that does
 * not yet exist (HDBSCAN is fit-only; local_label is run-local). Both the cache
 * and a stable lifeline identity arrive with the Phase-4 tracking slice; the
 * displayed lifeline label is then derived at the tracked-lifeline level, so
 * Phase-4 does not inherit per-window label churn.
 */

import type { ClusterLabel } from "../types";

/**
 * The future rewrite boundary: a deterministic ClusterLabel bundle → one clean
 * human phrase. Documented as a shared return contract (a display string the UI
 * shows) so the deterministic path and the later LLM path are interchangeable.
 * The implementation — an async call to a gated, cached LLM port — lands with
 * its own config flag; this interface is only the shape it will satisfy.
 */
export interface ClusterNamer {
  /**
   * Rewrite the deterministic evidence bundle into a single human phrase that
   * replaces ClusterLabel.display_label.
   *
   * @param label       the deterministic ClusterLabel (headline_title / scope /
   *                    keyphrases) — the evidence bundle.
   * @param fingerprint the stable-core key the rewrite is cached on; the namer
   *                    re-fires only when the fingerprint changes.
   */
  name_cluster(label: ClusterLabel, fingerprint: ClusterFingerprint): Promise<string>;
}

/**
 * The geometric + stable-core cache key (plan §7). Deliberately NOT an
 * exemplar-id hash: a single exemplar flips on tiny changes (over-firing) and
 * hub pages collide (under-firing). Instead the rewrite re-fires only when the
 * representative vector moves beyond a cosine threshold, OR the stable core's
 * Jaccard overlap drops below ~0.8. This reuses the same representative-vector +
 * cosine machinery the Phase-4 tracker uses — one mechanism, not two.
 */
export interface ClusterFingerprint {
  /** FROZEN L2-normalized representative vector (RepresentedCluster.representative_vector). */
  representative_vector: Float32Array;
  /**
   * The STABLE CORE: page_session_ids of members whose membership probability is
   * above a cutoff (excluding noise and low-probability fringe), sorted so the
   * Jaccard overlap between two runs is a stable comparison.
   */
  stable_core: string[];
}
