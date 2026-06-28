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

// Run keying and record assembly are tf-free (node `crypto` only), so re-exporting
// them here does not pull the native TensorFlow chain into barrel consumers.
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

// Validation harness: only the tf-free pieces (scoring, report helpers, the
// operating point, and DTOs) are re-exported. validation/sweep.ts is NOT — it
// imports clustering-tfjs PCA and reuses the clustering core, pulling the native
// TensorFlow chain — so consumers import run_sweep / evaluate_guardrail from
// ./validation/sweep directly and feed the results to the tf-free helpers here.
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
  ValidationReport,
  KnownProject,
} from "./validation/types";
export {
  score_cell,
  boundary_fragmentation_count,
  cross_window_variance,
  visits_per_month,
  aggregate_sweep,
  summarize_validation,
  redownload_volume,
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

// cluster_window.ts and representations.ts are NOT re-exported: their
// `clustering-tfjs` import pulls the native TensorFlow backend chain, which any
// barrel consumer would then have to bundle. The labeling/ modules are tf-free
// but are internal pipeline stages a consumer imports directly, so only the
// ClusterLabel DTO (above) is re-exported for the persist adapter and MCP surface.

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
 * The package's public entry point for the windowed HDBSCAN micro-tier over one
 * window. It fixes the dependency-injection seam: callers supply concrete ports
 * via {@link TdtDeps}, the library owns the pipeline (fetch visits, resolve page
 * vectors, build the cosine distance matrix, fit HDBSCAN, represent, label,
 * persist).
 */
export async function run_tdt(_deps: TdtDeps, _args: TdtArgs): Promise<void> {
  return;
}
