import {
  DuckDB,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  create_metadata_schema,
} from "../duck_db";
import { DuckDBListValue } from "@duckdb/node-api";
import { ClusterStore } from "./cluster_store";
import type {
  RunBundle,
  RunRecord,
  ClusterRecord,
  MemberRecord,
} from "@bergamot/tdt";

/** Byte-level equality of two Float32Arrays (catches ±0, which toEqual misses). */
function bytes_equal(a: Float32Array, b: Float32Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}

const REPR_VEC = new Float32Array([0.1, 1 / 3, 0.9999999, -123.456, 0.5, 2.5e-8]);

interface BundleOverrides {
  run_id?: string;
  window_start?: string;
  window_end?: string;
  embedding_model_id?: string;
  input_fingerprint?: string;
  created_at?: string;
  /** Number of clustered members (label 0); plus `noise` noise members. */
  clustered?: number;
  noise?: number;
  keyphrases?: string[];
}

/**
 * Build a RunBundle directly (bypassing the pure assembler — these tests target
 * the store, not assembly). `run_id` defaults from the natural key so two bundles
 * with the same window+model share an id unless overridden.
 */
function make_bundle(o: BundleOverrides = {}): RunBundle {
  const window_start = o.window_start ?? "2024-01-01T00:00:00.000Z";
  const window_end = o.window_end ?? "2024-02-01T00:00:00.000Z";
  const embedding_model_id = o.embedding_model_id ?? "model-a@384";
  const run_id =
    o.run_id ?? `run:${window_start}:${window_end}:${embedding_model_id}`;
  const created_at = o.created_at ?? "2024-02-02T00:00:00.000Z";
  const clustered = o.clustered ?? 2;
  const noise = o.noise ?? 1;

  const cluster: ClusterRecord = {
    id: `${run_id}#c0`,
    run_id,
    local_label: 0,
    size: clustered,
    exemplar_page_session_id: "p0",
    representative_vector: REPR_VEC,
    coherence: null,
    time_span_start: window_start,
    time_span_end: window_end,
    headline_title: "Alpha",
    scope: "x.com",
    keyphrases: o.keyphrases ?? ["alpha", "beta"],
    display_label: "Alpha — x.com",
    representation_version: "det-1",
    lifeline_id: null,
  };

  const members: MemberRecord[] = [];
  for (let i = 0; i < clustered; i++) {
    members.push({
      run_id,
      page_session_id: `p${i}`,
      cluster_id: cluster.id,
      is_noise: false,
      probability: 0.9 - i * 0.1,
      page_loaded_at: window_start,
      is_exemplar: i === 0,
    });
  }
  for (let i = 0; i < noise; i++) {
    members.push({
      run_id,
      page_session_id: `n${i}`,
      cluster_id: null,
      is_noise: true,
      probability: 0,
      page_loaded_at: window_start,
      is_exemplar: false,
    });
  }

  const run: RunRecord = {
    id: run_id,
    window_start,
    window_end,
    params_hash: "ph",
    params_json: '{"k":1}',
    embedding_model_id,
    algo_version: "hdbscan-1#wasm",
    input_count: clustered + noise,
    input_fingerprint: o.input_fingerprint ?? "fp-1",
    cluster_count: 1,
    noise_count: noise,
    status: "complete",
    created_at,
    completed_at: created_at,
  };

  return { run, clusters: [cluster], members };
}

describe("ClusterStore", () => {
  let db: DuckDB;
  let store: ClusterStore;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    store = new ClusterStore(db);
  });

  afterEach(async () => {
    await db.close();
  });

  async function count(table: string, where = "", params = {}): Promise<number> {
    const row = await db.query_first<{ n: number }>(
      `SELECT count(*) AS n FROM ${table} ${where}`,
      params,
    );
    return Number(row?.n ?? 0);
  }

  describe("schema (AC#1)", () => {
    it("creates the three cluster tables", async () => {
      for (const table of [
        TOPIC_RUN_TABLE,
        TOPIC_CLUSTER_TABLE,
        TOPIC_CLUSTER_MEMBER_TABLE,
      ]) {
        await expect(count(table)).resolves.toBe(0);
      }
    });
  });

  describe("first persist", () => {
    it("inserts the run, clusters and members", async () => {
      const result = await store.persist(make_bundle());
      expect(result.outcome).toBe("created");
      expect(result.superseded_run_ids).toEqual([]);
      expect(await count(TOPIC_RUN_TABLE)).toBe(1);
      expect(await count(TOPIC_CLUSTER_TABLE)).toBe(1);
      expect(await count(TOPIC_CLUSTER_MEMBER_TABLE)).toBe(3);
    });

    it("round-trips the FLOAT[] representative_vector byte-identically", async () => {
      await store.persist(make_bundle());
      const row = await db.query_first<{ representative_vector: unknown }>(
        `SELECT representative_vector FROM ${TOPIC_CLUSTER_TABLE}`,
      );
      const value = row!.representative_vector;
      expect(value).toBeInstanceOf(DuckDBListValue);
      const got = Float32Array.from((value as DuckDBListValue).items, (x) =>
        Number(x),
      );
      expect(bytes_equal(got, REPR_VEC)).toBe(true);
    });

    it("round-trips keyphrases as a TEXT[] in order", async () => {
      await store.persist(make_bundle({ keyphrases: ["gamma", "delta", "eps"] }));
      const row = await db.query_first<{ keyphrases: unknown }>(
        `SELECT keyphrases FROM ${TOPIC_CLUSTER_TABLE}`,
      );
      const items = (row!.keyphrases as DuckDBListValue).items.map(String);
      expect(items).toEqual(["gamma", "delta", "eps"]);
    });

    it("stores empty keyphrases as NULL (DuckDB rejects an empty list literal)", async () => {
      await store.persist(make_bundle({ keyphrases: [] }));
      const row = await db.query_first<{ keyphrases: unknown }>(
        `SELECT keyphrases FROM ${TOPIC_CLUSTER_TABLE}`,
      );
      expect(row!.keyphrases).toBeNull();
    });
  });

  describe("no-op (AC#2, AC#5)", () => {
    it("returns 'noop' on a re-persist of the same id + fingerprint", async () => {
      await store.persist(make_bundle());
      const again = await store.persist(make_bundle());
      expect(again.outcome).toBe("noop");
    });

    it("writes nothing on a no-op (row counts unchanged)", async () => {
      await store.persist(make_bundle());
      await store.persist(make_bundle());
      expect(await count(TOPIC_RUN_TABLE)).toBe(1);
      expect(await count(TOPIC_CLUSTER_TABLE)).toBe(1);
      expect(await count(TOPIC_CLUSTER_MEMBER_TABLE)).toBe(3);
    });

    it("preserves the original created_at on a no-op", async () => {
      await store.persist(make_bundle({ created_at: "2024-02-02T00:00:00.000Z" }));
      await store.persist(make_bundle({ created_at: "2025-09-09T00:00:00.000Z" }));
      const row = await db.query_first<{ created_at: string }>(
        `SELECT created_at FROM ${TOPIC_RUN_TABLE}`,
      );
      expect(row!.created_at).toBe("2024-02-02T00:00:00.000Z");
    });
  });

  describe("atomic replace (AC#3, AC#5)", () => {
    it("returns 'replaced' when the same id has a changed fingerprint", async () => {
      await store.persist(make_bundle({ input_fingerprint: "fp-1" }));
      const replaced = await store.persist(
        make_bundle({ input_fingerprint: "fp-2", clustered: 3, noise: 2 }),
      );
      expect(replaced.outcome).toBe("replaced");
    });

    it("replaces the clusters and members in place, keeping one run row", async () => {
      await store.persist(make_bundle({ input_fingerprint: "fp-1", clustered: 2, noise: 1 }));
      await store.persist(make_bundle({ input_fingerprint: "fp-2", clustered: 3, noise: 2 }));

      expect(await count(TOPIC_RUN_TABLE)).toBe(1);
      expect(await count(TOPIC_CLUSTER_MEMBER_TABLE)).toBe(5); // 3 + 2, old 3 gone
      const run = await db.query_first<{
        input_fingerprint: string;
        input_count: number;
        status: string;
      }>(`SELECT input_fingerprint, input_count, status FROM ${TOPIC_RUN_TABLE}`);
      expect(run!.input_fingerprint).toBe("fp-2");
      expect(Number(run!.input_count)).toBe(5);
      expect(run!.status).toBe("complete");
    });

    it("preserves created_at across a replace", async () => {
      await store.persist(
        make_bundle({ input_fingerprint: "fp-1", created_at: "2024-02-02T00:00:00.000Z" }),
      );
      await store.persist(
        make_bundle({ input_fingerprint: "fp-2", created_at: "2025-09-09T00:00:00.000Z" }),
      );
      const row = await db.query_first<{ created_at: string; completed_at: string }>(
        `SELECT created_at, completed_at FROM ${TOPIC_RUN_TABLE}`,
      );
      expect(row!.created_at).toBe("2024-02-02T00:00:00.000Z");
      expect(row!.completed_at).toBe("2025-09-09T00:00:00.000Z");
    });

    it("detects a late-arriving visit as a fingerprint change → replace", async () => {
      await store.persist(make_bundle({ input_fingerprint: "fp-before", clustered: 2, noise: 1 }));
      const r = await store.persist(
        make_bundle({ input_fingerprint: "fp-after", clustered: 2, noise: 2 }),
      );
      expect(r.outcome).toBe("replaced");
      expect(await count(TOPIC_CLUSTER_MEMBER_TABLE)).toBe(4);
    });
  });

  describe("supersede (AC#3, AC#5)", () => {
    it("supersedes the prior live run when a new key lands for the same window", async () => {
      const a = await store.persist(make_bundle({ embedding_model_id: "model-a@384" }));
      const b = await store.persist(make_bundle({ embedding_model_id: "model-b@384" }));

      expect(b.outcome).toBe("created");
      expect(b.superseded_run_ids).toEqual([a.run_id]);

      const statuses = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM ${TOPIC_RUN_TABLE} ORDER BY id`,
      );
      const by_id = new Map(statuses.map((s) => [s.id, s.status]));
      expect(by_id.get(a.run_id)).toBe("superseded");
      expect(by_id.get(b.run_id)).toBe("complete");
    });

    it("retains both runs' history and keeps exactly one complete run per window", async () => {
      await store.persist(make_bundle({ embedding_model_id: "model-a@384" }));
      await store.persist(make_bundle({ embedding_model_id: "model-b@384" }));

      expect(await count(TOPIC_RUN_TABLE)).toBe(2); // history retained
      expect(
        await count(
          TOPIC_RUN_TABLE,
          `WHERE window_start = $ws AND window_end = $we AND status = 'complete'`,
          { ws: "2024-01-01T00:00:00.000Z", we: "2024-02-01T00:00:00.000Z" },
        ),
      ).toBe(1);
      // The superseded run keeps its clusters/members.
      expect(await count(TOPIC_CLUSTER_TABLE)).toBe(2);
    });

    it("does not supersede a run in a different window", async () => {
      await store.persist(make_bundle({ window_start: "2024-01-01T00:00:00.000Z" }));
      const b = await store.persist(
        make_bundle({
          window_start: "2024-03-01T00:00:00.000Z",
          window_end: "2024-04-01T00:00:00.000Z",
        }),
      );
      expect(b.superseded_run_ids).toEqual([]);
      expect(
        await count(TOPIC_RUN_TABLE, `WHERE status = 'complete'`),
      ).toBe(2);
    });
  });

  describe("coverage (AC#4, AC#5)", () => {
    it("derives clustered/total from member rows alone", async () => {
      const { run_id } = await store.persist(make_bundle({ clustered: 3, noise: 1 }));
      const cov = await store.coverage(run_id);
      expect(cov).toEqual({
        run_id,
        total: 4,
        clustered: 3,
        noise: 1,
        coverage: 0.75,
      });
    });

    it("reports coverage 0 for an all-noise run", async () => {
      const { run_id } = await store.persist(make_bundle({ clustered: 0, noise: 3 }));
      const cov = await store.coverage(run_id);
      expect(cov).toMatchObject({ total: 3, clustered: 0, noise: 3, coverage: 0 });
    });

    it("returns null for a run with no members", async () => {
      expect(await store.coverage("no-such-run")).toBeNull();
    });
  });
});
