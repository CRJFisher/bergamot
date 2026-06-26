import * as express from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import request from "supertest";
import { listValue } from "@duckdb/node-api";
import { ServerManager } from "./server_manager";
import {
  DuckDB,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  create_metadata_schema,
} from "../duck_db";

const W_START = "2026-06-01T00:00:00.000Z";
const W_END = "2026-07-01T00:00:00.000Z";

async function seed_cluster(db: DuckDB): Promise<void> {
  await db.execute(
    `INSERT INTO ${TOPIC_RUN_TABLE}
       (id, window_start, window_end, params_hash, params_json, embedding_model_id,
        algo_version, input_count, input_fingerprint, cluster_count, noise_count,
        status, created_at, completed_at)
     VALUES ('run-1', $ws, $we, 'ph', '{}', 'm@384', 'algo', 1, 'fp', 1, 0,
        'complete', $ws, $ws)`,
    { ws: W_START, we: W_END },
  );
  await db.execute(
    `INSERT INTO ${TOPIC_CLUSTER_TABLE}
       (id, run_id, local_label, size, exemplar_page_session_id, representative_vector,
        coherence, time_span_start, time_span_end, headline_title, scope, keyphrases,
        display_label, representation_version, lifeline_id)
     VALUES ('c0', 'run-1', 0, 1, 'p0', $vec, 0.7, $ws, $we, 'Alpha', 'x.com',
        $kp, 'Alpha — x.com', 'det-1', NULL)`,
    { ws: W_START, we: W_END, vec: listValue([0.1, 0.2]), kp: listValue(["alpha"]) },
  );
  await db.execute(
    `INSERT INTO ${TOPIC_CLUSTER_MEMBER_TABLE}
       (run_id, page_session_id, cluster_id, is_noise, probability, page_loaded_at, is_exemplar)
     VALUES ('run-1', 'p0', 'c0', FALSE, 0.9, $ws, TRUE)`,
    { ws: W_START },
  );
}

describe("cluster routes (task-36.8)", () => {
  let db: DuckDB;
  let manager: ServerManager;
  let app: express.Application;
  let staging_root: string;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    await seed_cluster(db);
    staging_root = fs.mkdtempSync(path.join(os.tmpdir(), "routes-staging-"));
    manager = new ServerManager({ duck_db: db, staging_root });
    const internals = manager as object as {
      setup_routes(): void;
      app: express.Application;
    };
    internals.setup_routes();
    app = internals.app;
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(staging_root, { recursive: true, force: true });
  });

  describe("read routes", () => {
    it("GET /query/clusters returns clusters in range; 400 without from/to", async () => {
      await request(app).get("/query/clusters").expect(400);
      const res = await request(app)
        .get("/query/clusters")
        .query({ from: W_START, to: W_END })
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe("c0");
    });

    it("GET /query/cluster returns a detail; 400 without id; null when unknown", async () => {
      await request(app).get("/query/cluster").expect(400);
      const res = await request(app).get("/query/cluster").query({ id: "c0" }).expect(200);
      expect(res.body.cluster.id).toBe("c0");
      const missing = await request(app).get("/query/cluster").query({ id: "nope" }).expect(200);
      expect(missing.body).toBeNull();
    });

    it("GET /query/clusters_for_page returns page_status; 400 without id", async () => {
      await request(app).get("/query/clusters_for_page").expect(400);
      const res = await request(app)
        .get("/query/clusters_for_page")
        .query({ page_session_id: "p0" })
        .expect(200);
      expect(res.body.page_status).toBe("clustered");
    });

    it("GET /query/cluster_coverage returns coverage; 400 without from/to", async () => {
      await request(app).get("/query/cluster_coverage").expect(400);
      const res = await request(app)
        .get("/query/cluster_coverage")
        .query({ from: W_START, to: W_END })
        .expect(200);
      expect(res.body[0].coverage).toBe(1);
    });
  });

  describe("POST /cluster_control", () => {
    it("suppress hides the cluster from subsequent reads", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "suppress", cluster_id: "c0" })
        .expect(200);
      const res = await request(app)
        .get("/query/clusters")
        .query({ from: W_START, to: W_END })
        .expect(200);
      expect(res.body).toHaveLength(0);
    });

    it("rename overrides the display_label", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "rename", cluster_id: "c0", display_label: "My thread" })
        .expect(200);
      const res = await request(app)
        .get("/query/clusters")
        .query({ from: W_START, to: W_END });
      expect(res.body[0].display_label).toBe("My thread");
    });

    it("rename with an empty label is rejected (400)", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "rename", cluster_id: "c0", display_label: "  " })
        .expect(400);
    });

    it("a control on an unknown cluster id returns 409", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "suppress", cluster_id: "ghost" })
        .expect(409);
    });

    it("never_cluster_origin normalizes to a registrable domain; bad origin -> 400", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "never_cluster_origin", origin: "https://sub.bank.com/x" })
        .expect(200);
      const { ClusterControlStore } = await import("../tdt/cluster_control_store");
      expect(await new ClusterControlStore(db).list_never_cluster_origins()).toEqual([
        "bank.com",
      ]);
      await request(app)
        .post("/cluster_control")
        .send({ kind: "never_cluster_origin", origin: "not a url" })
        .expect(400);
    });

    it("an unknown kind is rejected (400)", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "bogus", cluster_id: "c0" })
        .expect(400);
    });
  });

  describe("POST /cluster_control/delete", () => {
    it("un-suppress restores the cluster to reads", async () => {
      await request(app)
        .post("/cluster_control")
        .send({ kind: "suppress", cluster_id: "c0" })
        .expect(200);
      let res = await request(app)
        .get("/query/clusters")
        .query({ from: W_START, to: W_END });
      expect(res.body).toHaveLength(0);

      await request(app)
        .post("/cluster_control/delete")
        .send({ kind: "suppress", cluster_id: "c0" })
        .expect(200);
      res = await request(app).get("/query/clusters").query({ from: W_START, to: W_END });
      expect(res.body).toHaveLength(1);
    });

    it("unblock removes a never-cluster origin", async () => {
      const { ClusterControlStore } = await import("../tdt/cluster_control_store");
      await request(app)
        .post("/cluster_control")
        .send({ kind: "never_cluster_origin", origin: "bank.com" })
        .expect(200);
      await request(app)
        .post("/cluster_control/delete")
        .send({ kind: "never_cluster_origin", origin: "bank.com" })
        .expect(200);
      expect(await new ClusterControlStore(db).list_never_cluster_origins()).toEqual([]);
    });
  });

  describe("POST /stage_cluster", () => {
    it("writes a stub for a live cluster", async () => {
      const res = await request(app)
        .post("/stage_cluster")
        .send({ cluster_id: "c0" })
        .expect(200);
      expect(res.body.kind).toBe("written");
      expect(fs.readdirSync(staging_root).filter((f) => f.endsWith(".md"))).toHaveLength(1);
    });

    it("returns 409 for an unknown cluster", async () => {
      await request(app)
        .post("/stage_cluster")
        .send({ cluster_id: "ghost" })
        .expect(409);
    });

    it("returns 503 when no staging root is configured", async () => {
      const no_staging = new ServerManager({ duck_db: db });
      const internals = no_staging as object as {
        setup_routes(): void;
        app: express.Application;
      };
      internals.setup_routes();
      await request(internals.app)
        .post("/stage_cluster")
        .send({ cluster_id: "c0" })
        .expect(503);
    });
  });
});
