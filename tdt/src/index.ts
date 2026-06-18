export type { RelationalReader, EmbedFn, VectorStore, ClusterSink } from "./ports";
export type { WindowSignal } from "./windowing";
export { compute_windows } from "./windowing";

export type {
  VisitRow,
  PageVector,
  DistanceMatrix,
  HdbscanRaw,
  RepresentedCluster,
  RunRecord,
  ClusterRecord,
  MemberRecord,
} from "./types";

export type { WindowConfig, HdbscanConfig } from "./config";
export { DEFAULT_WINDOW_CONFIG, DEFAULT_HDBSCAN_CONFIG } from "./config";

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
