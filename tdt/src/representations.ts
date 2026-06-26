// Cluster representations (plan §7 "Representative", build-order step 5). Turns
// the run-local HDBSCAN output (HdbscanRaw) into one RepresentedCluster per
// cluster: a representative page and a FROZEN L2-normalized representative
// vector. Noise (label -1) yields no cluster.
//
// The representative page is the `eom` exemplar (the densest-core point the
// library stores in exemplar_indices_), falling back to the library's
// select_medoids when a cluster has no stored exemplar (storeExemplars off, or
// the `leaf` selection method — neither is the v1 default, so the fallback is
// defensive; AC#1 and plan §10 still require it correct).
//
// Like cluster_window.ts, this module imports clustering-tfjs (select_medoids),
// which pulls the native TensorFlow backend chain — so it is NOT re-exported
// from the index.ts barrel; the orchestrator (TASK-36.9) imports it directly.
//
// The frozen representative vector is computed here in pure JS (float64,
// fixed-order accumulation, one float32 truncation — mirroring page_vectors.ts),
// NOT reused from select_medoids' internal float32 mean: that mean is computed
// on a tf backend in library-internal order and is not byte-stable, whereas the
// frozen vector is persisted and cosine-compared by the Phase-4 cross-window
// tracker, so it must be deterministic independent of backend.

import { select_medoids } from "clustering-tfjs";

import type { HdbscanRaw, PageVector, VisitRow, RepresentedCluster } from "./types";

// The "is this vector meaningless" floor. Pinned to the same value as
// page_vectors.ts's degenerate_norm_epsilon (config.ts), but kept as a separate
// literal because this module takes no config — it is not literally the same
// constant. A cluster mean can collapse below this when members are
// near-antipodal (HDBSCAN clusters on density, not hemisphere coherence), in
// which case we fall back to the representative member's own unit vector rather
// than emit a near-zero direction.
const NORM_EPSILON = 1e-6;

function l2_norm(v: Float64Array): number {
  let sum = 0;
  for (let d = 0; d < v.length; d++) sum += v[d] * v[d];
  return Math.sqrt(sum);
}

/**
 * Frozen representative vector = L2-normalized mean of the member vectors.
 * Members are accumulated in float64 in ascending member-index order (the stable
 * fetch order, the §6 determinism anchor) and truncated to float32 exactly once.
 *
 * Degenerate guard: if the mean's norm collapses below ε (near-antipodal
 * members), fall back to `representative_member_vector` rather than a near-zero
 * direction. A zero vector would read as "orthogonal to everything" and silently
 * corrupt the tracker's cosine match, so unlike page_vectors.ts (which zeroes
 * degenerate segments) we never emit zero here.
 *
 * @param representative_member_vector the representative page's own vector, used
 *   verbatim on collapse. It is already unit-norm because PageVector.vector is
 *   L2-normalized upstream (types.ts) — this function relies on that invariant
 *   rather than re-normalizing.
 */
function frozen_representative_vector(
  member_indices: number[],
  vectors: PageVector[],
  representative_member_vector: Float32Array,
): Float32Array {
  const dim = vectors[member_indices[0]].vector.length;
  const acc = new Float64Array(dim);
  for (const i of member_indices) {
    const v = vectors[i].vector;
    for (let d = 0; d < dim; d++) acc[d] += v[d];
  }
  const inv_n = 1 / member_indices.length;
  for (let d = 0; d < dim; d++) acc[d] *= inv_n;

  const norm = l2_norm(acc);
  const out = new Float32Array(dim);
  if (norm < NORM_EPSILON) {
    out.set(representative_member_vector); // an owned copy, not an alias
    return out;
  }
  const inv = 1 / norm;
  for (let d = 0; d < dim; d++) out[d] = acc[d] * inv;
  return out;
}

/**
 * Build one RepresentedCluster per HDBSCAN cluster (label >= 0). Noise (-1)
 * produces no cluster and never contributes to any representative.
 *
 * The three arrays are PARALLEL: `raw.labels[i]`, `vectors[i]` and `visits[i]`
 * describe the same row — the i-th page fed to the cosine distance matrix. All
 * exemplar / medoid indices index into this shared row space. The alignment is
 * load-bearing (a mis-zip silently mislabels every cluster), so it is asserted
 * up front, fail-loud, before any work.
 *
 * Async to await the `select_medoids` fallback. The fallback is off the v1
 * default path (eom + storeExemplars always yields exemplars), but the contract
 * stays async so wiring it in never has to change; the branch is exercised by
 * representations.test.ts via a raw with an empty exemplar map.
 *
 * @throws if the parallel-array lengths disagree, a per-row page_session_id
 *   mismatch reveals a mis-zip, or a resolved representative index is out of
 *   range (a library-contract regression).
 */
export async function represent_clusters(
  raw: HdbscanRaw,
  vectors: PageVector[],
  visits: VisitRow[],
): Promise<RepresentedCluster[]> {
  const n = raw.labels.length;
  if (vectors.length !== n || visits.length !== n || raw.probabilities.length !== n) {
    throw new Error(
      `represent_clusters: misaligned inputs — labels=${n}, probabilities=` +
        `${raw.probabilities.length}, vectors=${vectors.length}, visits=${visits.length}; ` +
        `all must be the parallel rows fed to clustering.`,
    );
  }
  for (let i = 0; i < n; i++) {
    if (vectors[i].page_session_id !== visits[i].page_session_id) {
      throw new Error(
        `represent_clusters: row ${i} mis-zipped — vector page ` +
          `${vectors[i].page_session_id} != visit page ${visits[i].page_session_id}.`,
      );
    }
  }

  // Group member rows by cluster label, in ascending label then ascending row
  // order (single forward pass preserves both — the deterministic member order).
  const members_by_label = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const label = raw.labels[i];
    if (label < 0) continue; // noise: no representative
    const bucket = members_by_label.get(label);
    if (bucket === undefined) members_by_label.set(label, [i]);
    else bucket.push(i);
  }
  if (members_by_label.size === 0) return [];

  const labels_asc = [...members_by_label.keys()].sort((a, b) => a - b);

  // Resolve representatives. The exemplar is preferred; the medoid fallback is
  // computed once over the FULL parallel array (select_medoids expects whole-
  // corpus X/labels and groups per label itself) only if some cluster lacks an
  // exemplar — which never happens under the v1 eom + storeExemplars defaults.
  const needs_medoid = labels_asc.some((label) => !raw.exemplar_indices.has(label));
  let medoid_indices: Int32Array | null = null;
  if (needs_medoid) {
    // Contiguity guard: the library emits dense labels 0..k-1 and select_medoids
    // returns one medoid per label, indexed by label value (clustering-tfjs
    // medoid_selection.js), so the distinct-label count must equal max+1. A
    // future library change that broke this would otherwise mis-index.
    const n_clusters = labels_asc[labels_asc.length - 1] + 1;
    if (n_clusters !== labels_asc.length) {
      throw new Error(
        `represent_clusters: non-contiguous cluster labels ${JSON.stringify(labels_asc)}; ` +
          `select_medoids requires dense 0..k-1.`,
      );
    }
    const X = vectors.map((v) => Array.from(v.vector));
    const result = await select_medoids(X, raw.labels, n_clusters, "cosine");
    medoid_indices = result.indices;
  }

  const clusters: RepresentedCluster[] = [];
  for (const label of labels_asc) {
    const member_indices = members_by_label.get(label)!;

    let representative_index = raw.exemplar_indices.get(label) ?? -1;
    if (representative_index < 0) {
      representative_index = medoid_indices![label];
    }
    if (representative_index < 0 || representative_index >= n) {
      throw new Error(
        `represent_clusters: cluster ${label} resolved an out-of-range ` +
          `representative index ${representative_index} (n=${n}).`,
      );
    }

    const representative_vector = frozen_representative_vector(
      member_indices,
      vectors,
      vectors[representative_index].vector,
    );

    // time_span = earliest/latest member visit. Order by parsed instant, not by
    // raw string: ISO-8601 is only lexicographically ordered when offset and
    // precision are uniform (mixed `Z` / `+00:00` / `.SSS` forms are not), and
    // Date.parse is spec-guaranteed to parse the ISO-8601 page_loaded_at. The
    // original strings are preserved as the stored bounds.
    let start_i = member_indices[0];
    let end_i = member_indices[0];
    let start_ms = Date.parse(visits[start_i].page_loaded_at);
    let end_ms = start_ms;
    for (const i of member_indices) {
      const ms = Date.parse(visits[i].page_loaded_at);
      if (ms < start_ms) { start_ms = ms; start_i = i; }
      if (ms > end_ms) { end_ms = ms; end_i = i; }
    }

    clusters.push({
      local_label: label,
      member_indices,
      representative_index,
      representative_vector,
      size: member_indices.length,
      time_span: { start: visits[start_i].page_loaded_at, end: visits[end_i].page_loaded_at },
    });
  }
  return clusters;
}
