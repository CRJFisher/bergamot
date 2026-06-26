/**
 * The four injected port contracts for @bergamot/tdt.
 *
 * @bergamot/tdt is a pure, dependency-injected library. It NEVER imports
 * vscode/src internals; the extension supplies concrete implementations of
 * the contracts below (in-process when TDT runs inside an extension command,
 * over the HTTP /query broker when it runs as the batch CLI).
 *
 * The clustering-tfjs fitted-state translation
 * (labels_ / probabilities_ / exemplar_indices_ → HdbscanRaw) is NOT here.
 * It is quarantined at the single fit() call site in cluster_window.ts (plan §6,
 * Stage 5). HdbscanRaw lives in types.ts. This file is library-agnostic by design.
 */

import type { VisitRow, RunBundle, PersistResult } from "./types";

/**
 * Reads captured visit metadata from DuckDB through the extension's broker.
 *
 * TDT never opens the capture DuckDB file directly (DuckDB is single-writer
 * per file; the extension holds it read-write for its lifetime — plan §3).
 * The production implementation reads via in-process reader fns or the HTTP
 * GET /query/visits_in_window route (plan §9).
 */
export interface RelationalReader {
  /**
   * One row per page visit with a capture in [start, end), ordered
   * page_loaded_at, page_session_id (the determinism anchor, plan §6 Stage 1).
   * @param start ISO-8601, inclusive.
   * @param end   ISO-8601, exclusive.
   */
  list_visits_in_window(start: string, end: string): Promise<VisitRow[]>;
}

/**
 * TDT's own local text embedding (plan §4). Returns a raw embedding vector;
 * L2-normalization is the caller's responsibility (page_vectors.ts).
 *
 * A callable type alias rather than an interface: invoked directly as
 * `await embed(text)`, trivially satisfied by a closure in fakes, and avoids
 * forced nominal typing.
 */
export type EmbedFn = (text: string) => Promise<Float32Array>;

/**
 * Page-vector cache backed by the TDT-owned topic_page_vector table (plan §8),
 * keyed by (page_session_id, embedding_model_id) so a model change is a clean
 * cache invalidation. Read/written through the extension's single DuckDB writer.
 */
export interface VectorStore {
  /** Cached L2-normalized page vector, or null on a miss. */
  get(
    page_session_id: string,
    embedding_model_id: string,
  ): Promise<Float32Array | null>;

  /**
   * Persist a freshly-built L2-normalized page vector.
   * @param repr the page-representation strategy used to build it
   *             (matches topic_page_vector.repr column, plan §8).
   */
  put(
    page_session_id: string,
    embedding_model_id: string,
    repr: string,
    vector: Float32Array,
  ): Promise<void>;
}

/**
 * Idempotent write port for one window's clustering result (plan §3, §8). The
 * production implementation is owned by the extension's single DuckDB writer,
 * which persists the run + clusters + members in ONE short transaction; the batch
 * CLI does read+compute only and supplies no writing ClusterSink.
 *
 * A single method, not three granular writes, because no-op / atomic-replace /
 * supersede are a DECISION over current DB state (does a complete run with this
 * id exist? does its input_fingerprint match?). Reading that state and writing
 * the result must be one atomic unit — three independent writes cannot express
 * it. The pure library hands over a fully-keyed RunBundle; the sink decides.
 */
export interface ClusterSink {
  persist(bundle: RunBundle): Promise<PersistResult>;
}
