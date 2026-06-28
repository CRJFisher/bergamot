/**
 * End-to-end integration for the clustering run (TASK-36.9, AC #4): a real
 * in-memory DuckDB seeded with a month of visits + page vectors, driven through
 * the real orchestrator → real HDBSCAN (`compute_clusters`, in-process here; the
 * forked-worker boundary is covered by cluster_worker_client.test.ts) → real
 * single-writer `ClusterStore.persist` (AC #3) → browsed back through the cluster
 * read surface (`list_clusters_in_range`). A second identical run exercises the
 * §6 memoization no-op (AC #6) end to end.
 */
import {
  DuckDB,
  create_metadata_schema,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_TREES_TABLE,
} from "../duck_db";
import {
  DEFAULT_WINDOW_CONFIG,
  DEFAULT_PAGE_VECTOR_CONFIG,
  type HdbscanConfig,
} from "@bergamot/tdt";
import { compute_clusters } from "@bergamot/tdt/out/cluster_pipeline";
import { rebuild_clusters, type RebuildDeps } from "./rebuild_clusters";
import { PageVectorStore } from "./page_vector_store";
import { ClusterStore } from "./cluster_store";
import { make_relational_reader } from "./visit_reads";
import {
  list_clusters_in_range,
  get_cluster,
  window_coverage,
} from "./cluster_reads";

const MODEL_ID = "bge-small-en-v1.5/q8/384#repr-v1";
const REPR = "main_content_extract";
const DIM = 8;

// Two well-separated clusters of 6 pages each — HDBSCAN recovers both at
// min_cluster_size 3, the lone unit vectors stay noise-free.
const HDBSCAN: HdbscanConfig = {
  min_cluster_size: 3,
  min_samples: 2,
  method: "eom",
  epsilon: 0,
};

function l2(parts: number[]): Float32Array {
  let norm = 0;
  for (const x of parts) norm += x * x;
  norm = Math.sqrt(norm);
  return Float32Array.from(parts, (x) => x / norm);
}

/**
 * A unit vector tightly clustered around a topic's shared direction. Group A
 * (axis 0) lives in span{0,1,2,3}, group B (axis 4) in span{4,5,6,7} — orthogonal
 * subspaces, so the two groups are far apart. Within a topic every page shares the
 * same strong direction (main axis + two fixed companion components) and differs
 * only by a tiny round-robin nudge on one companion axis (`i % 3`), keeping the
 * vectors distinct without any 2-way structure. Crucially there is NO monotonic or
 * parity jitter: a gradient or `i % 2` split would carve a topic into spurious
 * sub-blobs that HDBSCAN surfaces as separate clusters (leaving the other topic as
 * noise). So each topic forms exactly one dense, non-degenerate blob of 6.
 */
function cluster_vector(axis: number, i: number): Float32Array {
  const parts = new Array(DIM).fill(0);
  parts[axis] = 1;
  parts[(axis + 1) % DIM] = 0.2;
  parts[(axis + 2) % DIM] = 0.1;
  parts[(axis + 1 + (i % 3)) % DIM] += 0.01; // tiny symmetric nudge — distinct, no sub-blobs
  return l2(parts);
}

async function seed_visit(
  db: DuckDB,
  id: string,
  url: string,
  day: number,
): Promise<void> {
  const t = new Date(Date.UTC(2026, 5, day, 12, 0, 0)).toISOString();
  await db.execute(
    `INSERT INTO ${WEBPAGE_TREES_TABLE} (id, latest_activity_time, first_load_time)
     VALUES ($id, $t, $t) ON CONFLICT DO NOTHING`,
    { id: `tree-${id}`, t },
  );
  await db.execute(
    `INSERT INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
     VALUES ($id, $url, NULL, NULL, $t, $tree)`,
    { id, url, t, tree: `tree-${id}` },
  );
  await db.execute(
    `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
       (page_session_id, url, title, content_type, captured_at)
     VALUES ($id, $url, $title, 'text/html', $t)`,
    { id, url, title: `Title ${id}`, t },
  );
}

function deps(db: DuckDB): RebuildDeps {
  const vector_store = new PageVectorStore(db);
  const cluster_store = new ClusterStore(db);
  return {
    reader: make_relational_reader(db),
    // Vectors are pre-seeded; the embed pass is a no-op in this fixture.
    vectorise: async () => undefined,
    read_vectors: (ids) => vector_store.list_for_pages(ids, MODEL_ID),
    compute: (input) => compute_clusters(input),
    sink: cluster_store,
    live_run_fingerprint: (ws, we, ph) =>
      cluster_store.live_run_fingerprint(ws, we, ph, MODEL_ID),
    list_never_cluster_origins: async () => [],
    now: () => "2026-06-30T00:00:00.000Z",
    embedding_model_id: MODEL_ID,
    window_config: DEFAULT_WINDOW_CONFIG,
    hdbscan_config: HDBSCAN,
    page_vector_config: DEFAULT_PAGE_VECTOR_CONFIG,
  };
}

const JUNE = {
  range_start: "2026-06-01T00:00:00.000Z",
  range_end: "2026-07-01T00:00:00.000Z",
};

describe("rebuild_clusters end-to-end (AC #4)", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    const vector_store = new PageVectorStore(db);

    // 12 visits across June: 6 on axis 0 (topic A), 6 on axis 4 (topic B).
    for (let i = 0; i < 12; i++) {
      const id = `p${i}`;
      await seed_visit(db, id, `https://site${i % 2}.com/${id}`, i + 1);
      const axis = i < 6 ? 0 : 4;
      await vector_store.put(id, MODEL_ID, REPR, cluster_vector(axis, i));
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it("clusters a real month and browses the result via the cluster surface", async () => {
    const report = await rebuild_clusters(deps(db), JUNE);

    expect(report.windows).toHaveLength(1);
    expect(report.windows[0].status).toBe("clustered");
    expect(report.windows[0].persist?.outcome).toBe("created");
    expect(report.windows[0].input_count).toBe(12);

    // Browse the persisted clusters through the read surface — the user-facing path.
    const clusters = await list_clusters_in_range(db, {
      from: JUNE.range_start,
      to: JUNE.range_end,
      limit: 100,
    });
    // Exactly the two seeded topics separated — not merged, not over-fragmented.
    expect(clusters).toHaveLength(2);

    // Each surfaced cluster's members are drawn from EXACTLY ONE seeded topic
    // (axis 0 = p0–p5, axis 4 = p6–p11), and together the two clusters cover all
    // 12 pages with no overlap — a real separation check, not just a count.
    const topic_a = new Set(["p0", "p1", "p2", "p3", "p4", "p5"]);
    const topic_b = new Set(["p6", "p7", "p8", "p9", "p10", "p11"]);
    const all_members: string[] = [];
    for (const c of clusters) {
      expect(c.size).toBeGreaterThanOrEqual(HDBSCAN.min_cluster_size);
      expect(typeof c.display_label).toBe("string");
      const detail = await get_cluster(db, { id: c.id });
      const ids = detail!.members.map((m) => m.page_session_id);
      all_members.push(...ids);
      const pure_a = ids.every((id) => topic_a.has(id));
      const pure_b = ids.every((id) => topic_b.has(id));
      expect(pure_a || pure_b).toBe(true);
    }
    expect([...all_members].sort()).toEqual(
      [...topic_a, ...topic_b].sort(),
    );

    // No page was forced into noise — both topics fully recovered (AC #4).
    const coverage = await window_coverage(db, {
      from: JUNE.range_start,
      to: JUNE.range_end,
    });
    expect(coverage).toHaveLength(1);
    expect(coverage[0].input_count).toBe(12);
    expect(coverage[0].noise_count).toBe(0);
  });

  it("a second identical run is an idempotent no-op — no re-fit, no new run (AC #6)", async () => {
    await rebuild_clusters(deps(db), JUNE);

    const before = await db.query_first<{ n: bigint }>(
      `SELECT count(*) AS n FROM topic_run WHERE status = 'complete'`,
    );

    const second = await rebuild_clusters(deps(db), JUNE);

    expect(second.windows[0].status).toBe("unchanged");
    expect(second.windows[0].persist).toBeNull();

    const after = await db.query_first<{ n: bigint }>(
      `SELECT count(*) AS n FROM topic_run WHERE status = 'complete'`,
    );
    // Exactly one live run survives both passes; the second wrote nothing.
    expect(Number(after?.n)).toBe(Number(before?.n));
    expect(Number(after?.n)).toBe(1);
  });
});
