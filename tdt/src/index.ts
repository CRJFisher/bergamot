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
} from "./types";

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

// cluster_window.ts and representations.ts are NOT re-exported here: their
// `clustering-tfjs` import pulls the native TensorFlow backend chain, which any
// consumer of this barrel (e.g. the extension's embed pass) would then have to
// bundle. The labeling/ modules (deterministic_labeler.ts, llm_naming_seam.ts)
// are tf-free but are also NOT re-exported: they are internal pipeline stages
// imported directly by the orchestrator (TASK-36.9), not consumer-facing
// entrypoints. Only their ClusterLabel DTO is re-exported (above), since the
// persist adapter and MCP surface reference it. The orchestrator owns wiring the
// tf-pulling stages into the runtime and externalising the native deps.

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
