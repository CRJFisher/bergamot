// Pure record assembly (plan §8, build-order step 6). Turns one window's compute
// output — the run-local HdbscanRaw, the RepresentedCluster[] + ClusterLabel[]
// from step 5, and the window's VisitRow[] — into a fully-keyed RunBundle ready
// for the ClusterSink to persist idempotently.
//
// Pure and tf-free: no I/O, no clock (created_at is INJECTED so the bundle is a
// deterministic function of its inputs), no clustering-tfjs import. The
// transactional no-op/replace/supersede decision is NOT here — it depends on
// current DB state the pure library never sees, so it lives in the production
// ClusterSink (vscode/src/tdt/cluster_store.ts).

import {
  type ResolvedParams,
  canonical_params_json,
  canonical_timestamp,
  compute_params_hash,
  compute_run_id,
  compute_cluster_id,
  compute_input_fingerprint,
} from "./run_keying";
import type {
  VisitRow,
  HdbscanRaw,
  RepresentedCluster,
  ClusterLabel,
  RunRecord,
  ClusterRecord,
  MemberRecord,
  RunBundle,
} from "./types";

export interface AssembleArgs {
  // Natural-key parts (window_start/window_end are the ACTUAL bounds used).
  window_start: string;
  window_end: string;
  embedding_model_id: string;
  algo_version: string;
  params: ResolvedParams;

  // The run's wall-clock identity. Injected (not read from a clock) so assembly
  // is deterministic; created_at and completed_at are forensic columns, never
  // part of any hash. v1 persists a finished result in one transaction, so there
  // is no observable 'running' state — completed_at = created_at.
  created_at: string;

  // The parallel row space fed to clustering, in the §6 stable fetch order.
  // visits[i], raw.labels[i], raw.probabilities[i], vector_versions[i] all
  // describe the same i-th page.
  visits: VisitRow[];
  vector_versions: string[]; // per-page topic_page_vector freshness token
  raw: HdbscanRaw;

  // One per cluster (label >= 0); `labels` is index-aligned to `represented`.
  represented: RepresentedCluster[];
  labels: ClusterLabel[];
}

/**
 * Assemble the RunBundle. Validates the parallel-array alignment fail-loud (a
 * mis-zip would silently mislabel every member), then:
 *   - computes run_id / params_hash / input_fingerprint via run_keying,
 *   - emits ONE ClusterRecord per cluster (noise is never a cluster),
 *   - emits ONE MemberRecord per input page — clustered rows carry their
 *     cluster_id and probability; noise rows carry is_noise=true, cluster_id=null,
 *     probability 0. Every page becomes a member row, which is what makes
 *     coverage (clustered/total) derivable from the cluster tables alone (AC#4).
 *
 * @throws if any parallel-array length disagrees, or a clustered row's label has
 *   no corresponding represented cluster (a step-5/step-6 contract regression).
 */
export function assemble_run_bundle(args: AssembleArgs): RunBundle {
  const n = args.visits.length;
  if (
    args.raw.labels.length !== n ||
    args.raw.probabilities.length !== n ||
    args.vector_versions.length !== n
  ) {
    throw new Error(
      `assemble_run_bundle: misaligned row arrays — visits=${n}, labels=` +
        `${args.raw.labels.length}, probabilities=${args.raw.probabilities.length}, ` +
        `vector_versions=${args.vector_versions.length}; all must be the parallel ` +
        `rows fed to clustering.`,
    );
  }
  if (args.represented.length !== args.labels.length) {
    throw new Error(
      `assemble_run_bundle: represented (${args.represented.length}) and labels ` +
        `(${args.labels.length}) must be index-aligned, one per cluster.`,
    );
  }

  // Canonicalize the window bounds to the same form run_id hashes them in, then
  // store and key off THAT form. Otherwise a differently-spelled-but-equivalent
  // ISO bound (e.g. with vs without milliseconds) would hash into the same run_id
  // yet store a different window string, and the supersede equality predicate
  // (window_start = $ws AND window_end = $we) would fail to match the prior run.
  const window_start = canonical_timestamp(args.window_start);
  const window_end = canonical_timestamp(args.window_end);

  const params_json = canonical_params_json(args.params);
  const params_hash = compute_params_hash(args.params);
  const run_id = compute_run_id({
    window_start,
    window_end,
    params_hash,
    embedding_model_id: args.embedding_model_id,
    algo_version: args.algo_version,
  });
  const input_fingerprint = compute_input_fingerprint(
    args.visits.map((v, i) => ({
      page_session_id: v.page_session_id,
      embedding_vector_version: args.vector_versions[i],
    })),
  );

  let noise_count = 0;
  for (const label of args.raw.labels) if (label < 0) noise_count++;

  const clusters: ClusterRecord[] = [];
  const cluster_id_by_label = new Map<number, string>();
  const exemplar_rows = new Set<number>();
  for (let k = 0; k < args.represented.length; k++) {
    const rc = args.represented[k];
    const label = args.labels[k];
    if (rc.representative_index < 0 || rc.representative_index >= n) {
      throw new Error(
        `assemble_run_bundle: cluster ${rc.local_label} has representative_index ` +
          `${rc.representative_index} out of range [0, ${n}) — a step-5 regression.`,
      );
    }
    const cluster_id = compute_cluster_id(run_id, rc.local_label);
    cluster_id_by_label.set(rc.local_label, cluster_id);
    // The exemplar (is_exemplar) is the representative chosen by step 5
    // (RepresentedCluster.representative_index — the eom exemplar, or the medoid
    // fallback), NOT HdbscanRaw.exemplar_indices directly; representations.ts is
    // the single authority on which row represents a cluster.
    exemplar_rows.add(rc.representative_index);
    clusters.push({
      id: cluster_id,
      run_id,
      local_label: rc.local_label,
      size: rc.size,
      exemplar_page_session_id: args.visits[rc.representative_index].page_session_id,
      representative_vector: rc.representative_vector,
      coherence: null, // validation score is TASK-36.7
      time_span_start: rc.time_span.start,
      time_span_end: rc.time_span.end,
      headline_title: label.headline_title,
      scope: label.scope,
      keyphrases: label.keyphrases,
      display_label: label.display_label,
      representation_version: label.representation_version,
      lifeline_id: null, // Phase-4 tracking seam
    });
  }

  const members: MemberRecord[] = [];
  for (let i = 0; i < n; i++) {
    const label = args.raw.labels[i];
    const is_noise = label < 0;
    let cluster_id: string | null = null;
    if (!is_noise) {
      const resolved = cluster_id_by_label.get(label);
      if (resolved === undefined) {
        throw new Error(
          `assemble_run_bundle: row ${i} has clustered label ${label} with no ` +
            `represented cluster — represent_clusters/persist contract mismatch.`,
        );
      }
      cluster_id = resolved;
    }
    members.push({
      run_id,
      page_session_id: args.visits[i].page_session_id,
      cluster_id,
      is_noise,
      probability: is_noise ? 0 : args.raw.probabilities[i],
      page_loaded_at: args.visits[i].page_loaded_at,
      is_exemplar: exemplar_rows.has(i),
    });
  }

  const run: RunRecord = {
    id: run_id,
    window_start,
    window_end,
    params_hash,
    params_json,
    embedding_model_id: args.embedding_model_id,
    algo_version: args.algo_version,
    input_count: n,
    input_fingerprint,
    cluster_count: clusters.length,
    noise_count,
    // v1 always persists a finished result, so status is 'complete' directly and
    // the counts are always set. The 'running'/'failed' states (and the nullable
    // counts that pair with 'running') are a forward seam for the TASK-36.9
    // orchestrator's two-phase / crash-recording lifecycle; v1 never writes them.
    status: "complete",
    created_at: args.created_at,
    completed_at: args.created_at,
  };

  return { run, clusters, members };
}
