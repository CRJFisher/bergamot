import { listValue } from "@duckdb/node-api";
import {
  DuckDB,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  WEBPAGE_TREES_TABLE,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  create_metadata_schema,
} from "../duck_db";
import {
  list_clusters_in_range,
  get_cluster,
  get_cluster_anchor,
  list_clusters_for_page,
  window_coverage,
  MAX_QUERY_LIMIT,
} from "./cluster_reads";
import {
  ClusterControlStore,
  compute_content_signature,
} from "./cluster_control_store";

const W_START = "2026-06-01T00:00:00.000Z";
const W_END = "2026-07-01T00:00:00.000Z";

async function insert_run(
  db: DuckDB,
  o: { id: string; status?: string; window_start?: string; window_end?: string },
): Promise<void> {
  await db.execute(
    `INSERT INTO ${TOPIC_RUN_TABLE}
       (id, window_start, window_end, params_hash, params_json, embedding_model_id,
        algo_version, input_count, input_fingerprint, cluster_count, noise_count,
        status, created_at, completed_at)
     VALUES ($id, $ws, $we, $id, '{}', 'm@384', 'algo', 0, 'fp', 0, 0,
        $status, $ws, $ws)`,
    {
      id: o.id,
      ws: o.window_start ?? W_START,
      we: o.window_end ?? W_END,
      status: o.status ?? "complete",
    },
  );
}

async function insert_cluster(
  db: DuckDB,
  o: {
    id: string;
    run_id: string;
    exemplar: string;
    start?: string;
    end?: string;
    headline_title?: string;
    scope?: string;
    keyphrases?: string[];
    display_label?: string;
    local_label?: number;
  },
): Promise<void> {
  const keyphrases = o.keyphrases ?? ["alpha", "beta"];
  await db.execute(
    `INSERT INTO ${TOPIC_CLUSTER_TABLE}
       (id, run_id, local_label, size, exemplar_page_session_id, representative_vector,
        coherence, time_span_start, time_span_end, headline_title, scope, keyphrases,
        display_label, representation_version, lifeline_id)
     VALUES ($id, $run_id, $local_label, 3, $exemplar, $vec, 0.7, $start, $end,
        $headline, $scope, $keyphrases, $display, 'det-1', NULL)`,
    {
      id: o.id,
      run_id: o.run_id,
      local_label: o.local_label ?? 0,
      exemplar: o.exemplar,
      vec: listValue([0.1, 0.2]),
      start: o.start ?? W_START,
      end: o.end ?? W_END,
      headline: o.headline_title ?? "Alpha",
      scope: o.scope ?? "x.com",
      keyphrases: keyphrases.length > 0 ? listValue(keyphrases) : null,
      display: o.display_label ?? "Alpha — x.com",
    },
  );
}

async function insert_member(
  db: DuckDB,
  o: {
    run_id: string;
    page_session_id: string;
    cluster_id: string | null;
    is_noise?: boolean;
    probability?: number;
    is_exemplar?: boolean;
    page_loaded_at?: string;
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO ${TOPIC_CLUSTER_MEMBER_TABLE}
       (run_id, page_session_id, cluster_id, is_noise, probability, page_loaded_at, is_exemplar)
     VALUES ($run_id, $psid, $cid, $is_noise, $prob, $loaded, $is_exemplar)`,
    {
      run_id: o.run_id,
      psid: o.page_session_id,
      cid: o.cluster_id,
      is_noise: o.is_noise ?? false,
      prob: o.probability ?? 0.9,
      loaded: o.page_loaded_at ?? W_START,
      is_exemplar: o.is_exemplar ?? false,
    },
  );
}

async function seed_page(
  db: DuckDB,
  o: { id: string; url: string; title?: string },
): Promise<void> {
  await db.execute(
    `INSERT INTO ${WEBPAGE_TREES_TABLE} (id, latest_activity_time, first_load_time)
     VALUES ($id, $t, $t) ON CONFLICT DO NOTHING`,
    { id: `tree-${o.id}`, t: W_START },
  );
  await db.execute(
    `INSERT INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
     VALUES ($id, $url, NULL, NULL, $t, $tree)`,
    { id: o.id, url: o.url, t: W_START, tree: `tree-${o.id}` },
  );
  if (o.title !== undefined) {
    await db.execute(
      `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
         (page_session_id, url, title, content_type, captured_at)
       VALUES ($id, $url, $title, 'text/html', $t)`,
      { id: o.id, url: o.url, title: o.title, t: W_START },
    );
  }
}

describe("cluster_reads", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("list_clusters_in_range", () => {
    beforeEach(async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
    });

    it("returns an overlapping cluster with the full summary, scope verbatim", async () => {
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        id: "c0",
        run_id: "run-live",
        display_label: "Alpha — x.com",
        headline_title: "Alpha",
        scope: "x.com",
        keyphrases: ["alpha", "beta"],
        size: 3,
        coherence: 0.7,
        time_span: { start: W_START, end: W_END },
        representation_version: "det-1",
      });
    });

    it("never exposes representative_vector or the exemplar id", async () => {
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out[0]).not.toHaveProperty("representative_vector");
      expect(out[0]).not.toHaveProperty("exemplar_page_session_id");
    });

    it("coerces counts to numbers, keyphrases to string[] (empty -> [])", async () => {
      await insert_cluster(db, {
        id: "c1",
        run_id: "run-live",
        exemplar: "p9",
        keyphrases: [],
        local_label: 1,
      });
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      const c1 = out.find((c) => c.id === "c1");
      expect(typeof c1!.size).toBe("number");
      expect(c1!.keyphrases).toEqual([]);
    });

    it("excludes clusters of superseded / failed runs", async () => {
      await insert_run(db, { id: "run-old", status: "superseded" });
      await insert_cluster(db, { id: "c-old", run_id: "run-old", exemplar: "p1" });
      await insert_run(db, { id: "run-fail", status: "failed" });
      await insert_cluster(db, { id: "c-fail", run_id: "run-fail", exemplar: "p2" });
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out.map((c) => c.id)).toEqual(["c0"]);
    });

    it("includes a cluster ending exactly at `from`, excludes one starting at `to`", async () => {
      const mid = "2026-06-15T00:00:00.000Z";
      // ends exactly at `mid` -> included (time_span_end >= from)
      await insert_cluster(db, {
        id: "c-ends-at-from",
        run_id: "run-live",
        exemplar: "pa",
        start: W_START,
        end: mid,
        local_label: 2,
      });
      // starts exactly at `to` -> excluded (time_span_start < to is false)
      await insert_cluster(db, {
        id: "c-starts-at-to",
        run_id: "run-live",
        exemplar: "pb",
        start: W_END,
        end: "2026-08-01T00:00:00.000Z",
        local_label: 3,
      });
      const out = await list_clusters_in_range(db, { from: mid, to: W_END });
      const ids = out.map((c) => c.id);
      expect(ids).toContain("c-ends-at-from");
      expect(ids).not.toContain("c-starts-at-to");
    });

    it("orders newest-first by time_span_start", async () => {
      await insert_cluster(db, {
        id: "c-late",
        run_id: "run-live",
        exemplar: "pl",
        start: "2026-06-20T00:00:00.000Z",
        local_label: 4,
      });
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out[0].id).toBe("c-late");
    });

    it("clamps the result to MAX_QUERY_LIMIT", async () => {
      for (let i = 0; i < MAX_QUERY_LIMIT + 5; i++) {
        await insert_cluster(db, {
          id: `cc${i}`,
          run_id: "run-live",
          exemplar: `px${i}`,
          local_label: 100 + i,
        });
      }
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out).toHaveLength(MAX_QUERY_LIMIT);
    });

    it("returns [] when nothing overlaps the range", async () => {
      const out = await list_clusters_in_range(db, {
        from: "2030-01-01T00:00:00.000Z",
        to: "2030-02-01T00:00:00.000Z",
      });
      expect(out).toEqual([]);
    });
  });

  describe("controls applied on read", () => {
    beforeEach(async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
    });

    it("drops a cluster suppressed by exemplar id", async () => {
      await new ClusterControlStore(db).upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "x" },
        W_START,
      );
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out).toEqual([]);
    });

    it("drops a cluster suppressed only by signature (exemplar churned)", async () => {
      const sig = compute_content_signature({
        headline_title: "Alpha",
        scope: "x.com",
        keyphrases: ["alpha", "beta"],
      });
      await new ClusterControlStore(db).upsert(
        {
          kind: "suppress",
          target_page_session_id: "different-page",
          content_signature: sig,
        },
        W_START,
      );
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out).toEqual([]);
    });

    it("applies a rename override to display_label and mirrors it in renamed_label", async () => {
      await new ClusterControlStore(db).upsert(
        {
          kind: "rename",
          target_page_session_id: "p0",
          content_signature: "x",
          display_label_override: "My research thread",
        },
        W_START,
      );
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out[0].display_label).toBe("My research thread");
      expect(out[0].renamed_label).toBe("My research thread");
    });

    it("leaves renamed_label null when no rename override applies", async () => {
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out[0].display_label).toBe("Alpha — x.com");
      expect(out[0].renamed_label).toBeNull();
    });

    it("applies a rename matched only by signature (exemplar churned)", async () => {
      const sig = compute_content_signature({
        headline_title: "Alpha",
        scope: "x.com",
        keyphrases: ["alpha", "beta"],
      });
      await new ClusterControlStore(db).upsert(
        {
          kind: "rename",
          target_page_session_id: "different-page",
          content_signature: sig,
          display_label_override: "Renamed by signature",
        },
        W_START,
      );
      const out = await list_clusters_in_range(db, { from: W_START, to: W_END });
      expect(out[0].display_label).toBe("Renamed by signature");
    });

    it("get_cluster returns null for a suppressed cluster", async () => {
      await new ClusterControlStore(db).upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "x" },
        W_START,
      );
      expect(await get_cluster(db, { id: "c0" })).toBeNull();
    });
  });

  describe("get_cluster", () => {
    beforeEach(async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
      await seed_page(db, { id: "p0", url: "https://x.com/0", title: "Page 0" });
      await seed_page(db, { id: "p1", url: "https://x.com/1", title: "Page 1" });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "p0",
        cluster_id: "c0",
        probability: 0.95,
        is_exemplar: true,
      });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "p1",
        cluster_id: "c0",
        probability: 0.6,
      });
    });

    it("returns the cluster, exemplar page and members ranked by probability", async () => {
      const detail = await get_cluster(db, { id: "c0" });
      expect(detail).not.toBeNull();
      expect(detail!.cluster.id).toBe("c0");
      expect(detail!.exemplar_page).toMatchObject({
        page_session_id: "p0",
        url: "https://x.com/0",
        title: "Page 0",
      });
      expect(detail!.members.map((m) => m.page_session_id)).toEqual(["p0", "p1"]);
      expect(detail!.members[0].is_exemplar).toBe(true);
    });

    it("returns null url/title for a member missing its page rows", async () => {
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "ghost",
        cluster_id: "c0",
        probability: 0.1,
      });
      const detail = await get_cluster(db, { id: "c0" });
      const ghost = detail!.members.find((m) => m.page_session_id === "ghost");
      expect(ghost).toMatchObject({ url: null, title: null });
    });

    it("caps members at MAX_QUERY_LIMIT yet keeps the exemplar present", async () => {
      // Exemplar at the lowest probability so it falls beyond the member cap;
      // get_cluster resolves it separately, so it must still be present.
      await db.execute(
        `UPDATE ${TOPIC_CLUSTER_MEMBER_TABLE} SET is_exemplar = FALSE
         WHERE run_id = 'run-live' AND page_session_id = 'p0'`,
      );
      await insert_cluster(db, {
        id: "c-big",
        run_id: "run-live",
        exemplar: "lonely-exemplar",
        local_label: 7,
      });
      await seed_page(db, { id: "lonely-exemplar", url: "https://x.com/ex" });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "lonely-exemplar",
        cluster_id: "c-big",
        probability: 0.001,
        is_exemplar: true,
      });
      for (let i = 0; i < MAX_QUERY_LIMIT + 5; i++) {
        await insert_member(db, {
          run_id: "run-live",
          page_session_id: `big-${i}`,
          cluster_id: "c-big",
          probability: 0.9,
        });
      }
      const detail = await get_cluster(db, { id: "c-big" });
      expect(detail!.members).toHaveLength(MAX_QUERY_LIMIT);
      expect(detail!.exemplar_page?.page_session_id).toBe("lonely-exemplar");
    });

    it("returns null for an unknown id", async () => {
      expect(await get_cluster(db, { id: "nope" })).toBeNull();
    });

    it("returns null for a cluster of a non-live run", async () => {
      await insert_run(db, { id: "run-old", status: "superseded" });
      await insert_cluster(db, { id: "c-old", run_id: "run-old", exemplar: "p0" });
      expect(await get_cluster(db, { id: "c-old" })).toBeNull();
    });
  });

  describe("get_cluster_anchor", () => {
    beforeEach(async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
    });

    it("resolves a live cluster to its exemplar id and content signature", async () => {
      const anchor = await get_cluster_anchor(db, "c0");
      expect(anchor).toEqual({
        exemplar_page_session_id: "p0",
        content_signature: compute_content_signature({
          headline_title: "Alpha",
          scope: "x.com",
          keyphrases: ["alpha", "beta"],
        }),
      });
    });

    it("returns null for an unknown id", async () => {
      expect(await get_cluster_anchor(db, "nope")).toBeNull();
    });

    it("returns null for a cluster of a non-live run", async () => {
      await insert_run(db, { id: "run-old", status: "superseded" });
      await insert_cluster(db, { id: "c-old", run_id: "run-old", exemplar: "p0" });
      expect(await get_cluster_anchor(db, "c-old")).toBeNull();
    });
  });

  describe("list_clusters_for_page", () => {
    it("clustered: page in a live cluster", async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "p0",
        cluster_id: "c0",
      });
      const out = await list_clusters_for_page(db, { page_session_id: "p0" });
      expect(out.page_status).toBe("clustered");
      expect(out.clusters.map((c) => c.id)).toEqual(["c0"]);
    });

    it("clustered-but-suppressed: page_status stays clustered with an empty clusters array", async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "p0",
        cluster_id: "c0",
      });
      await new ClusterControlStore(db).upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "x" },
        W_START,
      );
      const out = await list_clusters_for_page(db, { page_session_id: "p0" });
      expect(out.page_status).toBe("clustered");
      expect(out.clusters).toEqual([]);
    });

    it("noise: page processed in a live run but landed as noise", async () => {
      await insert_run(db, { id: "run-live" });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "pn",
        cluster_id: null,
        is_noise: true,
        probability: 0,
      });
      const out = await list_clusters_for_page(db, { page_session_id: "pn" });
      expect(out.page_status).toBe("noise");
      expect(out.clusters).toEqual([]);
    });

    it("unseen: page in no live run", async () => {
      const out = await list_clusters_for_page(db, { page_session_id: "never" });
      expect(out.page_status).toBe("unseen");
      expect(out.clusters).toEqual([]);
    });

    it("classifies by the LIVE run: clustered in a superseded run but noise live -> noise", async () => {
      await insert_run(db, { id: "run-old", status: "superseded" });
      await insert_cluster(db, { id: "c-old", run_id: "run-old", exemplar: "p0" });
      await insert_member(db, {
        run_id: "run-old",
        page_session_id: "p0",
        cluster_id: "c-old",
      });
      await insert_run(db, { id: "run-live" });
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "p0",
        cluster_id: null,
        is_noise: true,
        probability: 0,
      });
      const out = await list_clusters_for_page(db, { page_session_id: "p0" });
      expect(out.page_status).toBe("noise");
    });
  });

  describe("window_coverage", () => {
    it("computes coverage = (input - noise) / input over a live run", async () => {
      await insert_run(db, { id: "run-live" });
      await insert_cluster(db, { id: "c0", run_id: "run-live", exemplar: "p0" });
      for (const id of ["p0", "p1", "p2"]) {
        await insert_member(db, {
          run_id: "run-live",
          page_session_id: id,
          cluster_id: "c0",
        });
      }
      await insert_member(db, {
        run_id: "run-live",
        page_session_id: "n0",
        cluster_id: null,
        is_noise: true,
        probability: 0,
      });
      const out = await window_coverage(db, { from: W_START, to: W_END });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        input_count: 4,
        cluster_count: 3,
        noise_count: 1,
        coverage: 0.75,
      });
    });

    it("a member-less live run yields input_count 0 and coverage 0 (no NaN)", async () => {
      await insert_run(db, { id: "run-empty" });
      const out = await window_coverage(db, { from: W_START, to: W_END });
      expect(out[0]).toMatchObject({ input_count: 0, coverage: 0 });
    });

    it("excludes superseded runs and returns [] when none overlap", async () => {
      await insert_run(db, { id: "run-old", status: "superseded" });
      await insert_member(db, {
        run_id: "run-old",
        page_session_id: "p0",
        cluster_id: null,
        is_noise: true,
        probability: 0,
      });
      const out = await window_coverage(db, {
        from: "2030-01-01T00:00:00.000Z",
        to: "2030-02-01T00:00:00.000Z",
      });
      expect(out).toEqual([]);
    });
  });
});
