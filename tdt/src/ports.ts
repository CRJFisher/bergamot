/**
 * The injected port contracts for @bergamot/tdt.
 *
 * @bergamot/tdt is a pure, dependency-injected library. It NEVER imports
 * vscode/src internals; the extension supplies concrete implementations of
 * the contracts below (in-process when TDT runs inside an extension command,
 * over the HTTP /query broker when it runs as the batch CLI).
 *
 * The clustering library's fitted-state translation is deliberately absent: it
 * is quarantined at the single fit() call site in cluster_window.ts so this file
 * stays library-agnostic.
 */

import type { VisitRow, RunBundle, PersistResult } from "./types";

/**
 * Reads captured visit metadata from DuckDB through the extension's broker.
 *
 * TDT never opens the capture DuckDB file directly: DuckDB is single-writer
 * per file and the extension holds it read-write for its lifetime.
 */
export interface RelationalReader {
  /**
   * One row per page visit with a capture in [start, end), ordered by
   * (page_loaded_at, page_session_id) — the clustering determinism anchor.
   * @param start ISO-8601, inclusive.
   * @param end   ISO-8601, exclusive.
   */
  list_visits_in_window(start: string, end: string): Promise<VisitRow[]>;
}

/**
 * TDT's own local text embedding. Returns a RAW embedding vector;
 * L2-normalization is the caller's responsibility (page_vectors.ts) so it
 * happens once after page-representation assembly rather than per segment.
 *
 * A callable type alias rather than an interface so it is trivially satisfied
 * by a closure in fakes and avoids forced nominal typing.
 */
export type EmbedFn = (text: string) => Promise<Float32Array>;

/**
 * Page-vector cache backed by the TDT-owned topic_page_vector table, keyed by
 * (page_session_id, embedding_model_id) so a model change is a clean cache
 * invalidation. Read/written through the extension's single DuckDB writer.
 */
export interface VectorStore {
  get(
    page_session_id: string,
    embedding_model_id: string,
  ): Promise<Float32Array | null>;

  /**
   * @param repr the page-representation strategy used to build the vector
   *             (matches the topic_page_vector.repr column).
   */
  put(
    page_session_id: string,
    embedding_model_id: string,
    repr: string,
    vector: Float32Array,
  ): Promise<void>;
}

/**
 * Idempotent write port for one window's clustering result. The production
 * implementation is owned by the extension's single DuckDB writer, which
 * persists the run + clusters + members in ONE short transaction; the batch CLI
 * does read+compute only and supplies no writing ClusterSink.
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
