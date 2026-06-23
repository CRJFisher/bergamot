/**
 * The production local text embedder (TASK-36.3.1) — TDT's injected `EmbedFn`,
 * backed by `bge-small-en-v1.5` (q8, 384-d) run fully on-device through
 * `@huggingface/transformers` / `onnxruntime-node`. No page content ever leaves
 * the machine: inference is local, and after a one-time model provisioning the
 * weights are served from the on-disk cache with remote fetches disabled.
 *
 * The `EmbedFn` embeds ONE segment per call and returns the RAW (un-normalized)
 * 384-d vector. `build_page_vector` (the caller) owns pooling ACROSS segments and
 * the single final L2-normalization (the `ports.ts` EmbedFn contract), so the
 * per-segment call uses `pooling: "mean"` (collapse the segment's tokens to one
 * vector) with `normalize: false` (keep it raw — pooling the raw embeddings is
 * what `build_page_vector` documents).
 *
 * Determinism: ONNX runs single-threaded and sequential, which makes the same
 * text embed byte-identically across calls (verified on the Intel x64 build) by
 * removing the parallel-reduction float non-associativity that breaks
 * reproducibility. The page vector is built once and stored, so this only bites
 * on a re-embed (model change / backfill); single-thread costs nothing at this
 * scale and is the safe default.
 *
 * Lifecycle: load the pipeline once, reuse it for every page in a pass, and
 * {@link LocalEmbedder.dispose} it when the pass ends — the model is resident
 * only while a pass runs, not for the extension's lifetime.
 */
import * as fs from "fs";
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import type { EmbedFn } from "@bergamot/tdt";
import {
  PAGE_EMBEDDING_DTYPE,
  PAGE_EMBEDDING_MODEL_NAME,
} from "./embedding_config";

/** A loaded embedder: the injected {@link EmbedFn} plus a model release. */
export interface LocalEmbedder {
  embed: EmbedFn;
  dispose(): Promise<void>;
}

// Single-threaded sequential ONNX execution — the determinism anchor. Passed
// through transformers.js to the onnxruntime-node InferenceSession.
const DETERMINISTIC_SESSION_OPTIONS = {
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  executionMode: "sequential" as const,
};

/**
 * Load the local page embedder, resolving the model from `model_cache_dir`.
 *
 * Offline by default: the model is served from the on-disk cache and remote
 * model fetches are disabled, so inference never reaches the network. If the
 * model is not yet cached and `allow_download` is set, the public weights are
 * fetched ONCE (never any page content) to populate the cache, after which
 * remote fetches are disabled again for the rest of the process.
 *
 * `env` is a process-global in transformers.js; this toggles `allowRemoteModels`
 * around the load. Callers must serialize embedder construction (the embed pass
 * is single-flight), so the toggle never races.
 *
 * @throws if the model is absent and `allow_download` is false (strict offline).
 */
export async function load_local_embedder(
  model_cache_dir: string,
  allow_download = true,
): Promise<LocalEmbedder> {
  fs.mkdirSync(model_cache_dir, { recursive: true });
  env.cacheDir = model_cache_dir;
  env.allowLocalModels = true;

  const load = (): Promise<FeatureExtractionPipeline> =>
    pipeline("feature-extraction", PAGE_EMBEDDING_MODEL_NAME, {
      dtype: PAGE_EMBEDDING_DTYPE,
      session_options: DETERMINISTIC_SESSION_OPTIONS,
    });

  let extractor: FeatureExtractionPipeline;
  // Try fully offline first — inference must never touch the network.
  env.allowRemoteModels = false;
  try {
    extractor = await load();
  } catch (offline_error) {
    if (!allow_download) throw offline_error;
    // One-time provisioning: fetch the public model weights into the cache,
    // then re-lock so no later load in this process can reach the network.
    env.allowRemoteModels = true;
    try {
      extractor = await load();
    } finally {
      env.allowRemoteModels = false;
    }
  }

  const embed: EmbedFn = async (text: string) => {
    const output = await extractor(text, { pooling: "mean", normalize: false });
    // Copy out of the pipeline's reused tensor buffer: build_page_vector retains
    // every segment vector across its sequential embed loop, so a view onto a
    // buffer the next call overwrites would corrupt the pooled result.
    return new Float32Array(output.data);
  };

  const dispose = async (): Promise<void> => {
    await extractor.dispose();
  };

  return { embed, dispose };
}
