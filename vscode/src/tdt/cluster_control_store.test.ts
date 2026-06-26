import { DuckDB, create_metadata_schema } from "../duck_db";
import {
  ClusterControlStore,
  control_id,
  compute_content_signature,
} from "./cluster_control_store";

const NOW = "2026-06-26T00:00:00.000Z";
const LATER = "2026-06-27T00:00:00.000Z";

describe("ClusterControlStore", () => {
  let db: DuckDB;
  let store: ClusterControlStore;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    store = new ClusterControlStore(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("control_id / signature", () => {
    it("is deterministic and distinct across kinds for one target", () => {
      expect(control_id("suppress", "p0")).toBe(control_id("suppress", "p0"));
      expect(control_id("suppress", "p0")).not.toBe(control_id("rename", "p0"));
    });

    it("signature is stable under keyphrase reordering, sensitive to content", () => {
      const a = compute_content_signature({
        headline_title: "Graph clustering",
        scope: "x.com",
        keyphrases: ["hdbscan", "graph"],
      });
      const b = compute_content_signature({
        headline_title: "Graph clustering",
        scope: "x.com",
        keyphrases: ["graph", "hdbscan"],
      });
      const c = compute_content_signature({
        headline_title: "Graph clustering",
        scope: "x.com",
        keyphrases: ["graph"],
      });
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });

  describe("suppress / rename", () => {
    it("resolves a suppression by exemplar id and signature", async () => {
      await store.upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "sig0" },
        NOW,
      );
      const resolved = await store.resolve_controls();
      expect(resolved.suppressed_exemplar_ids.has("p0")).toBe(true);
      expect(resolved.suppressed_signatures.has("sig0")).toBe(true);
    });

    it("resolves a rename to its override by exemplar id and signature", async () => {
      await store.upsert(
        {
          kind: "rename",
          target_page_session_id: "p1",
          content_signature: "sig1",
          display_label_override: "My project",
        },
        NOW,
      );
      const resolved = await store.resolve_controls();
      expect(resolved.rename_by_exemplar_id.get("p1")).toBe("My project");
      expect(resolved.rename_by_signature.get("sig1")).toBe("My project");
    });

    it("upsert of the same kind+target is idempotent: one row, created_at preserved", async () => {
      await store.upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "a" },
        NOW,
      );
      await store.upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "b" },
        LATER,
      );
      const rows = await store.list("suppress");
      expect(rows).toHaveLength(1);
      expect(rows[0].created_at).toBe(NOW);
      expect(rows[0].updated_at).toBe(LATER);
      expect(rows[0].content_signature).toBe("b");
    });

    it("suppress and rename of one page coexist as distinct rows", async () => {
      await store.upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "s" },
        NOW,
      );
      await store.upsert(
        {
          kind: "rename",
          target_page_session_id: "p0",
          content_signature: "s",
          display_label_override: "X",
        },
        NOW,
      );
      expect(await store.list()).toHaveLength(2);
    });

    it("delete removes only the targeted control", async () => {
      await store.upsert(
        { kind: "suppress", target_page_session_id: "p0", content_signature: "s" },
        NOW,
      );
      await store.upsert(
        {
          kind: "rename",
          target_page_session_id: "p0",
          content_signature: "s",
          display_label_override: "X",
        },
        NOW,
      );
      await store.delete("suppress", { page_session_id: "p0" });
      const rows = await store.list();
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("rename");
    });
  });

  describe("never_cluster_origin", () => {
    it("lists blocked registrable domains", async () => {
      await store.upsert(
        { kind: "never_cluster_origin", target_origin: "bank.com" },
        NOW,
      );
      await store.upsert(
        { kind: "never_cluster_origin", target_origin: "health.gov" },
        NOW,
      );
      expect(await store.list_never_cluster_origins()).toEqual([
        "bank.com",
        "health.gov",
      ]);
    });

    it("does not surface origin rows as suppress/rename in resolve_controls", async () => {
      await store.upsert(
        { kind: "never_cluster_origin", target_origin: "bank.com" },
        NOW,
      );
      const resolved = await store.resolve_controls();
      expect(resolved.suppressed_exemplar_ids.size).toBe(0);
      expect(resolved.rename_by_exemplar_id.size).toBe(0);
    });

    it("delete removes a blocked origin", async () => {
      await store.upsert(
        { kind: "never_cluster_origin", target_origin: "bank.com" },
        NOW,
      );
      await store.delete("never_cluster_origin", { origin: "bank.com" });
      expect(await store.list_never_cluster_origins()).toEqual([]);
    });
  });
});
