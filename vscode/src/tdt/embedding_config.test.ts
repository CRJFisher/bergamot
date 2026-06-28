/**
 * Pins the composition of PAGE_EMBEDDING_MODEL_ID. It is the page-vector cache +
 * cluster key: an accidental change to its format silently invalidates every
 * stored page vector, so these tests fail loudly when the format drifts without
 * an intended model/quantization/dim/representation change.
 */
import {
  PAGE_EMBEDDING_DIM,
  PAGE_EMBEDDING_DTYPE,
  PAGE_EMBEDDING_MODEL_ID,
  PAGE_REPRESENTATION_VERSION,
} from "./embedding_config";

describe("PAGE_EMBEDDING_MODEL_ID", () => {
  test("equals the pinned bge-small-en-v1.5/q8/384#repr-v1 cache key", () => {
    expect(PAGE_EMBEDDING_MODEL_ID).toBe("bge-small-en-v1.5/q8/384#repr-v1");
  });

  test("composes weights, quantization, dim, and representation version", () => {
    expect(PAGE_EMBEDDING_MODEL_ID).toBe(
      `bge-small-en-v1.5/${PAGE_EMBEDDING_DTYPE}/${PAGE_EMBEDDING_DIM}#${PAGE_REPRESENTATION_VERSION}`,
    );
  });

  test("omits the HuggingFace org prefix that the loader uses", () => {
    expect(PAGE_EMBEDDING_MODEL_ID.startsWith("Xenova/")).toBe(false);
  });

  test("separates the representation version with a # so it reads as a cache suffix", () => {
    const [model_part, repr_part] = PAGE_EMBEDDING_MODEL_ID.split("#");
    expect(model_part).toBe("bge-small-en-v1.5/q8/384");
    expect(repr_part).toBe(PAGE_REPRESENTATION_VERSION);
  });
});
