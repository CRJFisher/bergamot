/**
 * The concrete DuckDB-backed page-vector store (TASK-36.3.1) — the production
 * implementation of the `@bergamot/tdt` {@link VectorStore} port over the
 * `topic_page_vector` table.
 *
 * The table lives in the EXISTING encrypted metadata DuckDB file (created by
 * {@link create_metadata_schema}), not a separate store: page vectors are
 * derived from captured metadata, so they belong to the same single-writer
 * file and join the right-to-forget cascade transactionally. This store is a
 * thin wrapper over the shared {@link DuckDB} handle the extension already owns
 * read-write — it never opens its own connection (the single-writer guarantee,
 * tdt-hdbscan-micro-tier-plan.md §3) and holds no encryption key of its own.
 *
 * The vector is stored as a DuckDB `FLOAT[]`: each component is a 32-bit float,
 * so the stored bytes are byte-identical to the L2-normalized `Float32Array`
 * `build_page_vector` produced (its single float32 truncation is the last one).
 * `FLOAT[]` is also the shape RAG's later `array_cosine_similarity` search
 * reuses, so there is no migration when that consumer lands
 * (tdt-hdbscan-micro-tier-plan.md §8).
 */
import { DuckDB, TOPIC_PAGE_VECTOR_TABLE } from "../duck_db";
import { listValue, DuckDBListValue } from "@duckdb/node-api";
import type { VectorStore } from "@bergamot/tdt";

/** Columns of {@link TOPIC_PAGE_VECTOR_TABLE}, in insert order. */
const TOPIC_PAGE_VECTOR_COLUMNS = [
  "page_session_id",
  "embedding_model_id",
  "vector",
  "repr",
  "built_at",
] as const;

/**
 * Read/write surface over the page-vector cache. One row per
 * `(page_session_id, embedding_model_id)`: re-resolving a page under the same
 * model id overwrites in place, so a forced re-embed wins; a new model id is a
 * distinct row (a clean cache miss), never a stale hit.
 */
export class PageVectorStore implements VectorStore {
  constructor(private readonly db: DuckDB) {}

  /** Cached L2-normalized page vector, or null on a miss. */
  async get(
    page_session_id: string,
    embedding_model_id: string,
  ): Promise<Float32Array | null> {
    const row = await this.db.query_first<{ vector: unknown }>(
      `SELECT vector FROM ${TOPIC_PAGE_VECTOR_TABLE}
       WHERE page_session_id = $page_session_id
         AND embedding_model_id = $embedding_model_id`,
      { page_session_id, embedding_model_id },
    );
    if (!row) return null;
    return to_float32(row.vector);
  }

  /**
   * Persist a freshly-built L2-normalized page vector. Upserts on the
   * `(page_session_id, embedding_model_id)` primary key.
   *
   * @throws RangeError if the vector is empty or carries a non-finite (NaN/±Inf)
   *   component — a degenerate vector must never reach the cosine matrix. The
   *   pure library already returns `null` for no-text / degenerate pages so this
   *   is the store's last-line guard, not the common path (AC #7).
   */
  async put(
    page_session_id: string,
    embedding_model_id: string,
    repr: string,
    vector: Float32Array,
  ): Promise<void> {
    if (vector.length === 0) {
      throw new RangeError(
        `PageVectorStore.put: empty vector for ${page_session_id}`,
      );
    }
    for (let d = 0; d < vector.length; d++) {
      if (!Number.isFinite(vector[d])) {
        throw new RangeError(
          `PageVectorStore.put: non-finite component for ${page_session_id}`,
        );
      }
    }
    await this.db.execute(
      `INSERT INTO ${TOPIC_PAGE_VECTOR_TABLE}
        (${TOPIC_PAGE_VECTOR_COLUMNS.join(", ")})
       VALUES
        ($page_session_id, $embedding_model_id, $vector, $repr, $built_at)
       ON CONFLICT (page_session_id, embedding_model_id) DO UPDATE SET
         vector = excluded.vector,
         repr = excluded.repr,
         built_at = excluded.built_at`,
      {
        page_session_id,
        embedding_model_id,
        // listValue binds a JS number[] as a DuckDB list; DuckDB rounds each
        // element to the column's 32-bit FLOAT at insert. The input is already
        // float32, so that rounding is the identity — the round-trip is exact.
        vector: listValue(Array.from(vector)),
        repr,
        built_at: new Date().toISOString(),
      },
    );
  }
}

/**
 * Reconstructs a `Float32Array` from a `FLOAT[]` column. `@duckdb/node-api`
 * reads a list column back as a {@link DuckDBListValue}; its `items` are JS
 * numbers, each the exact double-widening of a stored 32-bit float, so
 * narrowing back to `Float32Array` reproduces the stored bytes exactly.
 */
function to_float32(value: unknown): Float32Array {
  if (!(value instanceof DuckDBListValue)) {
    throw new Error(
      `topic_page_vector.vector is not a list (${typeof value}) — stale metadata schema`,
    );
  }
  return Float32Array.from(value.items, (item) => Number(item));
}
