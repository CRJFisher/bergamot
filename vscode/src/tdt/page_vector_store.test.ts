import { DuckDB, TOPIC_PAGE_VECTOR_TABLE, create_metadata_schema } from "../duck_db";
import { PageVectorStore } from "./page_vector_store";

const MODEL_ID = "bge-small-en-v1.5/q8/384#repr-v1";
const REPR = "main_content_extract";

/** Byte-level equality of two Float32Arrays (catches ±0, which toEqual misses). */
function bytes_equal(a: Float32Array, b: Float32Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}

describe("PageVectorStore", () => {
  let db: DuckDB;
  let store: PageVectorStore;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    store = new PageVectorStore(db);
  });

  afterEach(async () => {
    await db.close();
  });

  async function row_count(): Promise<number> {
    const row = await db.query_first<{ n: number }>(
      `SELECT count(*) AS n FROM ${TOPIC_PAGE_VECTOR_TABLE}`,
    );
    return Number(row?.n ?? 0);
  }

  it("misses for an un-vectorised page", async () => {
    expect(await store.get("nope", MODEL_ID)).toBeNull();
  });

  it("round-trips a vector byte-identically", async () => {
    // Awkward but representative values: a third (not f32-exact), a near-one, a
    // tiny positive, a large negative. (DuckDB FLOAT collapses signed zero, but
    // an L2-normalized embedding component is never exactly ±0, so it is not
    // tested here — every value we actually store round-trips bit-for-bit.)
    const vector = new Float32Array([0.1, 1 / 3, 0.9999999, 2.5e-8, -123.456, 0.5]);
    await store.put("p1", MODEL_ID, REPR, vector);

    const got = await store.get("p1", MODEL_ID);
    expect(got).not.toBeNull();
    expect(got!.length).toBe(vector.length);
    expect(bytes_equal(got!, vector)).toBe(true);
  });

  it("upserts in place under the same (page, model) key", async () => {
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([0, 1, 0]);
    await store.put("p1", MODEL_ID, REPR, v1);
    await store.put("p1", MODEL_ID, REPR, v2);

    expect(await row_count()).toBe(1);
    expect(bytes_equal((await store.get("p1", MODEL_ID))!, v2)).toBe(true);
  });

  it("keys on (page_session_id, embedding_model_id) — a new model id is a clean miss", async () => {
    const other_model = "gte-small/q8/384#repr-v1";
    const v_a = new Float32Array([1, 0, 0]);
    const v_b = new Float32Array([0, 0, 1]);
    await store.put("p1", MODEL_ID, REPR, v_a);

    // Same page, different model → miss (the invalidation property, AC #5).
    expect(await store.get("p1", other_model)).toBeNull();

    // Both coexist once written; neither overwrites the other.
    await store.put("p1", other_model, REPR, v_b);
    expect(await row_count()).toBe(2);
    expect(bytes_equal((await store.get("p1", MODEL_ID))!, v_a)).toBe(true);
    expect(bytes_equal((await store.get("p1", other_model))!, v_b)).toBe(true);
  });

  it("rejects an empty vector", async () => {
    await expect(
      store.put("p1", MODEL_ID, REPR, new Float32Array(0)),
    ).rejects.toThrow(RangeError);
    expect(await row_count()).toBe(0);
  });

  it("rejects a non-finite (NaN / Infinity) component", async () => {
    await expect(
      store.put("p1", MODEL_ID, REPR, new Float32Array([1, NaN, 0])),
    ).rejects.toThrow(RangeError);
    await expect(
      store.put("p1", MODEL_ID, REPR, new Float32Array([1, Infinity, 0])),
    ).rejects.toThrow(RangeError);
    expect(await row_count()).toBe(0);
  });
});
