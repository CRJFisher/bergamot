/**
 * The canonical page-embedding configuration (TASK-36.3.1): the model identity,
 * representation strategy, and vector-construction knobs the batched embed pass
 * runs under. Centralized here so the `embedding_model_id` (the cache + cluster
 * key) and the actually-loaded model stay in lockstep — the
 * `resolve_page_vector` caller invariant (page_vectors.ts).
 *
 * Changing any component (model, quantization, dim, or the representation rule)
 * yields a new {@link PAGE_EMBEDDING_MODEL_ID}, which is a clean page-vector
 * cache miss: the next embed pass re-embeds affected pages, and (downstream) a
 * new clustering run key supersedes the old. See
 * backlog/drafts/tdt-embedding-model-selection.md.
 */
import {
  DEFAULT_PAGE_VECTOR_CONFIG,
  type PageRepr,
  type PageVectorConfig,
} from "@bergamot/tdt";

/**
 * The HuggingFace repo the local embedder loads (the value passed to
 * `pipeline()`). Distinct from {@link PAGE_EMBEDDING_MODEL_ID}, the cache key.
 */
export const PAGE_EMBEDDING_MODEL_REPO = "Xenova/bge-small-en-v1.5";

/** ONNX quantization variant selected via the pipeline `dtype` option. */
export const PAGE_EMBEDDING_DTYPE = "q8";

/** Embedding dimension `PAGE_EMBEDDING_MODEL_REPO` produces. */
export const PAGE_EMBEDDING_DIM = 384;

/**
 * The page-representation-rule version. Bump when `build_page_text`'s rule (or
 * this module's `PAGE_EMBEDDING_REPR` / config) changes the page-level text, so
 * the new representation is a clean cache miss rather than a stale hit.
 */
export const PAGE_REPRESENTATION_VERSION = "repr-v1";

/**
 * The page-representation strategy. `main_content_extract` embeds the full
 * extracted main content (segmented + mean-pooled under the 512-token budget),
 * the richest signal for whole-page clustering. Pinned in lockstep with the
 * `#repr-v1` suffix of {@link PAGE_EMBEDDING_MODEL_ID}.
 */
export const PAGE_EMBEDDING_REPR: PageRepr = "main_content_extract";

/**
 * The cache + clustering key: model + quantization + dim + representation-rule
 * version, e.g. `bge-small-en-v1.5/q8/384#repr-v1`. The HuggingFace org prefix
 * (`Xenova/`) is intentionally omitted — it is a mirror detail; the weights,
 * quantization, dim, and representation rule are what define cache identity.
 */
export const PAGE_EMBEDDING_MODEL_ID = `bge-small-en-v1.5/${PAGE_EMBEDDING_DTYPE}/${PAGE_EMBEDDING_DIM}#${PAGE_REPRESENTATION_VERSION}`;

/** Page-vector construction knobs (segment budget, dispersion floor, epsilon). */
export const PAGE_EMBEDDING_CONFIG: PageVectorConfig = DEFAULT_PAGE_VECTOR_CONFIG;
