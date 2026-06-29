import { DuckDB } from "./connection";
import { create_metadata_schema } from "./schema";
import {
  WEBPAGE_TREES_TABLE,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  TOPIC_PAGE_VECTOR_TABLE,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  TOPIC_CLUSTER_CONTROL_TABLE,
} from "./table_names";

async function make_db(): Promise<DuckDB> {
  const db = new DuckDB({ database_path: ":memory:" });
  await db.init();
  return db;
}

describe("create_metadata_schema", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = await make_db();
    await create_metadata_schema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent — calling twice does not throw", async () => {
    await expect(create_metadata_schema(db)).resolves.not.toThrow();
  });

  it("creates all required tables", async () => {
    const tables = [
      WEBPAGE_TREES_TABLE,
      WEBPAGE_ACTIVITY_SESSIONS_TABLE,
      WEBPAGE_CAPTURE_TABLE,
      WEBPAGE_FETCH_TABLE,
      TOPIC_PAGE_VECTOR_TABLE,
      TOPIC_RUN_TABLE,
      TOPIC_CLUSTER_TABLE,
      TOPIC_CLUSTER_MEMBER_TABLE,
      TOPIC_CLUSTER_CONTROL_TABLE,
    ];
    for (const table of tables) {
      await expect(
        db.query(`SELECT * FROM ${table} LIMIT 0`)
      ).resolves.not.toThrow();
    }
  });

  it("webpage_trees enforces a NOT NULL primary key", async () => {
    await expect(
      db.execute(
        `INSERT INTO ${WEBPAGE_TREES_TABLE} (id, first_load_time, latest_activity_time)
         VALUES ($id, $first, $latest)`,
        { id: "tree-1", first: "2024-01-01T00:00:00Z", latest: "2024-01-01T00:00:00Z" }
      )
    ).resolves.not.toThrow();

    await expect(
      db.execute(
        `INSERT INTO ${WEBPAGE_TREES_TABLE} (id, first_load_time, latest_activity_time)
         VALUES ($id, $first, $latest)`,
        { id: "tree-1", first: "2024-01-01T00:00:00Z", latest: "2024-01-01T00:00:00Z" }
      )
    ).rejects.toThrow();
  });

  it("webpage_activity_sessions enforces foreign key to webpage_trees", async () => {
    await expect(
      db.execute(
        `INSERT INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
           (id, url, page_loaded_at, tree_id)
         VALUES ($id, $url, $loaded, $tree)`,
        { id: "s1", url: "https://x.com", loaded: "2024-01-01", tree: "nonexistent-tree" }
      )
    ).rejects.toThrow();
  });

  it("webpage_capture primary key rejects duplicate page_session_id", async () => {
    await db.execute(
      `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
         (page_session_id, url, title, content_type, captured_at)
       VALUES ($id, $url, $title, $ct, $at)`,
      { id: "cap-1", url: "https://a.com", title: "A", ct: "text/html", at: "2024-01-01" }
    );
    await expect(
      db.execute(
        `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
           (page_session_id, url, title, content_type, captured_at)
         VALUES ($id, $url, $title, $ct, $at)`,
        { id: "cap-1", url: "https://b.com", title: "B", ct: "text/html", at: "2024-01-01" }
      )
    ).rejects.toThrow();
  });

  it("topic_page_vector table exists and is queryable", async () => {
    // The table uses a composite PK; insertion with FLOAT[] requires explicit
    // DuckDB type hints (tested via PageVectorStore in page_vector_store.test.ts).
    await expect(
      db.query(`SELECT * FROM ${TOPIC_PAGE_VECTOR_TABLE} LIMIT 0`)
    ).resolves.not.toThrow();
  });

  it("topic_cluster_member primary key is (run_id, page_session_id)", async () => {
    const member = {
      run_id: "run-1",
      page_session_id: "p1",
      is_noise: false,
      probability: 0.9,
      page_loaded_at: "2024-01-01",
    };
    await db.execute(
      `INSERT INTO ${TOPIC_CLUSTER_MEMBER_TABLE}
         (run_id, page_session_id, is_noise, probability, page_loaded_at)
       VALUES ($run_id, $page_session_id, $is_noise, $probability, $page_loaded_at)`,
      member
    );
    await expect(
      db.execute(
        `INSERT INTO ${TOPIC_CLUSTER_MEMBER_TABLE}
           (run_id, page_session_id, is_noise, probability, page_loaded_at)
         VALUES ($run_id, $page_session_id, $is_noise, $probability, $page_loaded_at)`,
        member
      )
    ).rejects.toThrow();
  });

  it("webpage_fetch keeps one row per fetch and rejects a duplicate fetch_id", async () => {
    const fetch_row = (fetch_id: string) => ({
      fetch_id,
      page_session_id: "page-1",
      url: "https://a.com",
      outcome: "ok",
      fetched_at: "2024-01-01T00:00:00Z",
    });
    await db.execute(
      `INSERT INTO ${WEBPAGE_FETCH_TABLE}
         (fetch_id, page_session_id, url, outcome, fetched_at)
       VALUES ($fetch_id, $page_session_id, $url, $outcome, $fetched_at)`,
      fetch_row("fetch-1")
    );
    await db.execute(
      `INSERT INTO ${WEBPAGE_FETCH_TABLE}
         (fetch_id, page_session_id, url, outcome, fetched_at)
       VALUES ($fetch_id, $page_session_id, $url, $outcome, $fetched_at)`,
      fetch_row("fetch-2")
    );
    const rows = await db.query<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM ${WEBPAGE_FETCH_TABLE} WHERE page_session_id = 'page-1'`
    );
    expect(rows[0].n).toBe(2n);

    await expect(
      db.execute(
        `INSERT INTO ${WEBPAGE_FETCH_TABLE}
           (fetch_id, page_session_id, url, outcome, fetched_at)
         VALUES ($fetch_id, $page_session_id, $url, $outcome, $fetched_at)`,
        fetch_row("fetch-1")
      )
    ).rejects.toThrow();
  });

  it("topic_run UNIQUE rejects a second run with the same natural key", async () => {
    const run = (id: string) => ({
      id,
      window_start: "2024-01-01T00:00:00Z",
      window_end: "2024-01-02T00:00:00Z",
      params_hash: "ph",
      params_json: "{}",
      embedding_model_id: "m@384",
      algo_version: "algo-1",
      input_count: 0,
      input_fingerprint: "fp",
      status: "complete",
      created_at: "2024-01-01T00:00:00Z",
    });
    const insert_sql = `INSERT INTO ${TOPIC_RUN_TABLE}
        (id, window_start, window_end, params_hash, params_json, embedding_model_id,
         algo_version, input_count, input_fingerprint, status, created_at)
      VALUES ($id, $window_start, $window_end, $params_hash, $params_json,
         $embedding_model_id, $algo_version, $input_count, $input_fingerprint,
         $status, $created_at)`;
    await db.execute(insert_sql, run("run-a"));
    await expect(db.execute(insert_sql, run("run-b"))).rejects.toThrow();
  });

  it("creates the named indexes used by the forget cascade and reads", async () => {
    const expected = [
      "idx_activity_sessions_url",
      "idx_activity_sessions_tree_id",
      "idx_activity_sessions_referrer",
      "idx_activity_sessions_loaded_at",
      "idx_trees_latest_activity",
      "idx_capture_title",
      "idx_topic_page_vector_page",
      "idx_topic_run_window",
      "idx_topic_run_status",
      "idx_topic_cluster_run",
      "idx_topic_member_cluster",
      "idx_topic_member_page",
      "idx_cluster_control_kind",
      "idx_cluster_control_page",
      "idx_cluster_control_origin",
    ];
    const rows = await db.query<{ index_name: string }>(
      `SELECT index_name FROM duckdb_indexes()`
    );
    const present = new Set(rows.map((r) => r.index_name));
    for (const name of expected) {
      expect(present.has(name)).toBe(true);
    }
  });
});
