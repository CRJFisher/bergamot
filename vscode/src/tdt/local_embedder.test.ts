/**
 * Unit tests for the embedder WRAPPER (offline/provisioning logic, ONNX flags,
 * tensor copy, dispose) with `@huggingface/transformers` mocked. The real model
 * is verified out-of-process by scripts/verify-embedder.mjs — onnxruntime-node's
 * native typed-array validation is incompatible with jest's VM realm, so the
 * real stack cannot run inside jest.
 */
import { PAGE_EMBEDDING_DIM } from "./embedding_config";

interface MockState {
  /** When false, an offline (allowRemoteModels=false) load throws. */
  cached: boolean;
  /** allowRemoteModels observed at each pipeline() call, in order. */
  remote_at_load: boolean[];
  /** (text, options) of each extractor invocation. */
  embed_calls: { text: string; options: unknown }[];
  /** The tensor buffer the extractor reuses across calls (the copy hazard). */
  reused_buffer: Float32Array;
  disposed: number;
}

jest.mock("@huggingface/transformers", () => {
  const state: MockState = {
    cached: true,
    remote_at_load: [],
    embed_calls: [],
    reused_buffer: new Float32Array(PAGE_EMBEDDING_DIM),
    disposed: 0,
  };
  const env = {
    cacheDir: "",
    allowLocalModels: false,
    allowRemoteModels: true,
  };
  const pipeline = jest.fn(
    async (_task: string, _name: string, _options: unknown) => {
      state.remote_at_load.push(env.allowRemoteModels);
      if (!state.cached && !env.allowRemoteModels) {
        throw new Error("model files not found locally");
      }
      state.cached = true; // a remote-allowed load populates the cache
      const extractor = async (text: string, options: unknown) => {
        state.embed_calls.push({ text, options });
        // Mirror onnxruntime: overwrite and hand back the SAME buffer each call
        // (a distinct value per call), so a returned view rather than a copy
        // would be clobbered by the next embed.
        state.reused_buffer.fill(0.5 + state.embed_calls.length - 1);
        return { data: state.reused_buffer };
      };
      extractor.dispose = async () => {
        state.disposed++;
      };
      return extractor;
    },
  );
  return { env, pipeline, __state: state, __reset: () => {
    state.cached = true;
    state.remote_at_load = [];
    state.embed_calls = [];
    state.reused_buffer = new Float32Array(PAGE_EMBEDDING_DIM);
    state.disposed = 0;
    env.cacheDir = "";
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
  } };
});

// Typed handles onto the mock (jest.requireMock returns the factory's object).
const transformers = jest.requireMock("@huggingface/transformers") as {
  env: { cacheDir: string; allowLocalModels: boolean; allowRemoteModels: boolean };
  pipeline: jest.Mock;
  __state: MockState;
  __reset: () => void;
};

import { load_local_embedder } from "./local_embedder";
import {
  PAGE_EMBEDDING_DTYPE,
  PAGE_EMBEDDING_MODEL_REPO,
} from "./embedding_config";

const CACHE_DIR = "/tmp/tdt-test-models";

describe("load_local_embedder", () => {
  beforeEach(() => {
    transformers.__reset();
    transformers.pipeline.mockClear();
  });

  it("loads the canonical model q8 with single-threaded sequential ONNX", async () => {
    const embedder = await load_local_embedder(CACHE_DIR, false);

    expect(transformers.pipeline).toHaveBeenCalledTimes(1);
    const [task, name, options] = transformers.pipeline.mock.calls[0];
    expect(task).toBe("feature-extraction");
    expect(name).toBe(PAGE_EMBEDDING_MODEL_REPO);
    expect(options.dtype).toBe(PAGE_EMBEDDING_DTYPE);
    expect(options.session_options).toEqual({
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: "sequential",
    });
    expect(transformers.env.cacheDir).toBe(CACHE_DIR);
    expect(transformers.env.allowLocalModels).toBe(true);
    await embedder.dispose();
  });

  it("embeds raw per-segment vectors with pooling=mean, normalize=false", async () => {
    const embedder = await load_local_embedder(CACHE_DIR, false);
    const vector = await embedder.embed("a segment of page text");

    expect(transformers.__state.embed_calls[0].text).toBe(
      "a segment of page text",
    );
    expect(transformers.__state.embed_calls[0].options).toEqual({
      pooling: "mean",
      normalize: false,
    });
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(PAGE_EMBEDDING_DIM);
    expect(Array.from(vector)).toEqual(
      Array(PAGE_EMBEDDING_DIM).fill(0.5),
    );
    await embedder.dispose();
  });

  it("copies each segment out of the pipeline's reused tensor buffer", async () => {
    const embedder = await load_local_embedder(CACHE_DIR, false);

    const first = await embedder.embed("segment one");
    // The pipeline overwrites and returns its single buffer on every call; an
    // earlier vector must survive a later embed for build_page_vector's pooling.
    await embedder.embed("segment two");

    expect(first).not.toBe(transformers.__state.reused_buffer);
    expect(transformers.__state.reused_buffer[0]).toBe(1.5);
    expect(first[0]).toBe(0.5);
    await embedder.dispose();
  });

  it("loads fully offline when the model is cached (no remote fetch)", async () => {
    transformers.__state.cached = true;
    await load_local_embedder(CACHE_DIR, true);

    // The single load happened with remote models disabled.
    expect(transformers.__state.remote_at_load).toEqual([false]);
    expect(transformers.env.allowRemoteModels).toBe(false);
  });

  it("provisions once when the model is absent, then re-locks remote fetches", async () => {
    transformers.__state.cached = false;
    await load_local_embedder(CACHE_DIR, true);

    // First load offline (throws), second with remote enabled (provisions).
    expect(transformers.__state.remote_at_load).toEqual([false, true]);
    expect(transformers.pipeline).toHaveBeenCalledTimes(2);
    // Remote fetches are re-locked after provisioning.
    expect(transformers.env.allowRemoteModels).toBe(false);
  });

  it("refuses to reach the network when the model is absent and downloads are off", async () => {
    transformers.__state.cached = false;
    await expect(load_local_embedder(CACHE_DIR, false)).rejects.toThrow(
      /not found locally/,
    );
    // Only the offline attempt was made; no remote-enabled load.
    expect(transformers.__state.remote_at_load).toEqual([false]);
  });

  it("disposes the model on release", async () => {
    const embedder = await load_local_embedder(CACHE_DIR, false);
    await embedder.dispose();
    expect(transformers.__state.disposed).toBe(1);
  });
});
