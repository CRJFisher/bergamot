export type { RelationalReader, EmbedFn, VectorStore, ClusterSink } from "./ports";
export type { WindowSignal } from "./windowing";
export { compute_windows } from "./windowing";

export type {
  VisitRow,
  PageRepr,
  PageContent,
  PageVector,
  DistanceMatrix,
  HdbscanRaw,
  RepresentedCluster,
  ClusterLabel,
  RunRecord,
  ClusterRecord,
  MemberRecord,
  RunBundle,
  PersistOutcome,
  PersistResult,
} from "./types";

// Run keying + record assembly are pure and tf-free (only node `crypto`), so —
// unlike cluster_window.ts / representations.ts — they are safe to re-export here.
export type {
  ResolvedParams,
  RunNaturalKey,
  FingerprintEntry,
} from "./run_keying";
export {
  canonical_json,
  canonical_params_json,
  canonical_timestamp,
  compute_params_hash,
  compute_run_id,
  compute_cluster_id,
  compute_input_fingerprint,
} from "./run_keying";
export type { AssembleArgs } from "./persist";
export { assemble_run_bundle } from "./persist";

export type { WindowConfig, HdbscanConfig, PageVectorConfig } from "./config";
export {
  DEFAULT_WINDOW_CONFIG,
  DEFAULT_HDBSCAN_CONFIG,
  DEFAULT_PAGE_VECTOR_CONFIG,
} from "./config";

export {
  build_page_vector,
  resolve_page_vector,
  dedupe_visits,
} from "./page_vectors";

// Validation harness (task-36.7). The tf-free pieces — scoring, the operating
// point, and all DTOs — are re-exported; validation/sweep.ts is NOT (it imports
// clustering-tfjs PCA and reuses cluster_window, pulling the native TensorFlow
// chain), exactly like cluster_window.ts / representations.ts above. The
// orchestrator (TASK-36.9) imports sweep.ts directly.
export type {
  Reduction,
  WindowInput,
  GridCell,
  CellScore,
  WindowScore,
  SweepResult,
  VarianceStat,
  CrossWindowVariance,
  GuardrailVerdict,
  PromotionVerdict,
  VisitsPerMonth,
  KnownProject,
} from "./validation/types";
export {
  score_cell,
  boundary_fragmentation_count,
  cross_window_variance,
  visits_per_month,
  aggregate_sweep,
} from "./validation/scoring";
export type {
  OperatingPoint,
  OperatingPointEntry,
} from "./validation/operating_point";
export {
  select_operating_point,
  serialize_operating_point,
  parse_operating_point,
  load_operating_point,
  operating_point_path,
} from "./validation/operating_point";

// cluster_window.ts and representations.ts are NOT re-exported here: their
// `clustering-tfjs` import pulls the native TensorFlow backend chain, which any
// consumer of this barrel (e.g. the extension's embed pass) would then have to
// bundle. The labeling/ modules are tf-free but are also NOT re-exported:
// deterministic_labeler.ts is an internal pipeline stage the orchestrator
// (TASK-36.9) imports directly, and llm_naming_seam.ts is a documented
// not-yet-built seam (types only) nothing consumes yet — neither is a
// consumer-facing entrypoint. Only the ClusterLabel DTO is re-exported (above),
// since the persist adapter and MCP surface reference it. The orchestrator owns
// wiring the tf-pulling stages into the runtime and externalising the native deps.

import type { RelationalReader, EmbedFn, VectorStore, ClusterSink } from "./ports";

export interface TdtDeps {
  reader: RelationalReader;
  embed: EmbedFn;
  vector_store: VectorStore;
  sink: ClusterSink;
}

export interface TdtArgs {
  window_start: string;
  window_end: string;
  embedding_model_id: string;
}

/**
 * Run the windowed HDBSCAN micro-tier over one window.
 *
 * Stub: the pipeline stages (fetch visits, resolve page vectors, build the
 * cosine distance matrix, fit HDBSCAN, represent, label, persist) land in
 * later subtasks of TASK-36. The dependency-injection seam is fixed here.
 */
export async function run_tdt(_deps: TdtDeps, _args: TdtArgs): Promise<void> {
  return;
}
