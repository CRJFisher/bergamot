import { assemble_run_bundle, type AssembleArgs } from "./persist";
import {
  compute_run_id,
  compute_params_hash,
  compute_cluster_id,
  compute_input_fingerprint,
  type ResolvedParams,
} from "./run_keying";
import {
  DEFAULT_HDBSCAN_CONFIG,
  DEFAULT_WINDOW_CONFIG,
  DEFAULT_PAGE_VECTOR_CONFIG,
} from "./config";
import type {
  VisitRow,
  HdbscanRaw,
  RepresentedCluster,
  ClusterLabel,
} from "./types";

const PARAMS: ResolvedParams = {
  hdbscan: DEFAULT_HDBSCAN_CONFIG,
  window: DEFAULT_WINDOW_CONFIG,
  page_vector: DEFAULT_PAGE_VECTOR_CONFIG,
  matryoshka_dim: null,
};

function visit(id: string, loaded_at: string): VisitRow {
  return {
    page_session_id: id,
    url: `https://x.com/${id}`,
    title: id,
    site_name: null,
    page_loaded_at: loaded_at,
    tree_id: "t1",
  };
}

function label(headline: string): ClusterLabel {
  return {
    headline_title: headline,
    scope: "x.com",
    keyphrases: ["alpha", "beta"],
    display_label: `${headline} — x.com`,
    representation_version: "det-1",
  };
}

function represented(
  local_label: number,
  member_indices: number[],
  representative_index: number,
): RepresentedCluster {
  return {
    local_label,
    member_indices,
    representative_index,
    representative_vector: Float32Array.from([1, 0, 0]),
    size: member_indices.length,
    time_span: { start: "2024-01-01T00:00:00.000Z", end: "2024-01-05T00:00:00.000Z" },
  };
}

// One cluster (rows 0,1,2; exemplar row 1) plus two noise rows (3,4).
function base_args(): AssembleArgs {
  const visits = [
    visit("p0", "2024-01-01T00:00:00.000Z"),
    visit("p1", "2024-01-02T00:00:00.000Z"),
    visit("p2", "2024-01-03T00:00:00.000Z"),
    visit("p3", "2024-01-04T00:00:00.000Z"),
    visit("p4", "2024-01-05T00:00:00.000Z"),
  ];
  const raw: HdbscanRaw = {
    labels: [0, 0, 0, -1, -1],
    probabilities: [0.9, 0.95, 0.8, 0, 0],
    exemplar_indices: new Map([[0, 1]]),
  };
  return {
    window_start: "2024-01-01T00:00:00Z",
    window_end: "2024-02-01T00:00:00Z",
    embedding_model_id: "bge-small-en-v1.5/q8/384#repr-v1",
    algo_version: "hdbscan-1#clustering-tfjs@0.6.1#wasm",
    params: PARAMS,
    created_at: "2024-02-02T12:00:00.000Z",
    visits,
    vector_versions: visits.map((v) => `ver-${v.page_session_id}`),
    raw,
    represented: [represented(0, [0, 1, 2], 1)],
    labels: [label("Alpha thread")],
  };
}

describe("assemble_run_bundle — run record", () => {
  it("keys the run with run_id, params_hash and input_fingerprint", () => {
    const args = base_args();
    const { run } = assemble_run_bundle(args);

    const params_hash = compute_params_hash(PARAMS);
    expect(run.params_hash).toBe(params_hash);
    expect(run.id).toBe(
      compute_run_id({
        window_start: args.window_start,
        window_end: args.window_end,
        params_hash,
        embedding_model_id: args.embedding_model_id,
        algo_version: args.algo_version,
      }),
    );
    expect(run.input_fingerprint).toBe(
      compute_input_fingerprint(
        args.visits.map((v, i) => ({
          page_session_id: v.page_session_id,
          embedding_vector_version: args.vector_versions[i],
        })),
      ),
    );
  });

  it("counts input, clusters and noise", () => {
    const { run } = assemble_run_bundle(base_args());
    expect(run.input_count).toBe(5);
    expect(run.cluster_count).toBe(1);
    expect(run.noise_count).toBe(2);
  });

  it("is status='complete' with completed_at = the injected created_at", () => {
    const { run } = assemble_run_bundle(base_args());
    expect(run.status).toBe("complete");
    expect(run.created_at).toBe("2024-02-02T12:00:00.000Z");
    expect(run.completed_at).toBe("2024-02-02T12:00:00.000Z");
  });

  it("is a pure function of its inputs — same args produce an identical run id and fingerprint", () => {
    const a = assemble_run_bundle(base_args());
    const b = assemble_run_bundle(base_args());
    expect(b.run.id).toBe(a.run.id);
    expect(b.run.input_fingerprint).toBe(a.run.input_fingerprint);
  });

  it("the injected created_at does not affect the run id (it is a forensic column, not in the key)", () => {
    const a = assemble_run_bundle(base_args());
    const b = assemble_run_bundle({ ...base_args(), created_at: "2025-09-09T09:09:09.000Z" });
    expect(b.run.id).toBe(a.run.id);
  });
});

describe("assemble_run_bundle — cluster records", () => {
  it("emits one cluster per represented cluster, ided by hash(run_id|local_label)", () => {
    const { run, clusters } = assemble_run_bundle(base_args());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe(compute_cluster_id(run.id, 0));
    expect(clusters[0].run_id).toBe(run.id);
    expect(clusters[0].local_label).toBe(0);
    expect(clusters[0].size).toBe(3);
  });

  it("resolves exemplar_page_session_id from the representative row index", () => {
    const { clusters } = assemble_run_bundle(base_args());
    // representative_index 1 -> visits[1] = p1
    expect(clusters[0].exemplar_page_session_id).toBe("p1");
  });

  it("carries the labeler fields and leaves coherence + lifeline_id null (v1 seams)", () => {
    const { clusters } = assemble_run_bundle(base_args());
    const c = clusters[0];
    expect(c.headline_title).toBe("Alpha thread");
    expect(c.scope).toBe("x.com");
    expect(c.keyphrases).toEqual(["alpha", "beta"]);
    expect(c.display_label).toBe("Alpha thread — x.com");
    expect(c.representation_version).toBe("det-1");
    expect(c.coherence).toBeNull();
    expect(c.lifeline_id).toBeNull();
  });
});

describe("assemble_run_bundle — member records (coverage is derivable, AC#4)", () => {
  it("emits one member per input page — clustered and noise", () => {
    const { members } = assemble_run_bundle(base_args());
    expect(members).toHaveLength(5);
    expect(members.map((m) => m.page_session_id)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  it("clustered members carry their cluster_id, probability and is_noise=false", () => {
    const { run, members } = assemble_run_bundle(base_args());
    const cluster_id = compute_cluster_id(run.id, 0);
    const p0 = members.find((m) => m.page_session_id === "p0")!;
    expect(p0.is_noise).toBe(false);
    expect(p0.cluster_id).toBe(cluster_id);
    expect(p0.probability).toBe(0.9);
  });

  it("noise members carry is_noise=true, cluster_id=null and probability 0", () => {
    const { members } = assemble_run_bundle(base_args());
    const p3 = members.find((m) => m.page_session_id === "p3")!;
    expect(p3.is_noise).toBe(true);
    expect(p3.cluster_id).toBeNull();
    expect(p3.probability).toBe(0);
  });

  it("flags is_exemplar on exactly the representative member of each cluster", () => {
    const { members } = assemble_run_bundle(base_args());
    const flagged = members.filter((m) => m.is_exemplar);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].page_session_id).toBe("p1");
  });

  it("denormalizes page_loaded_at onto each member", () => {
    const { members } = assemble_run_bundle(base_args());
    expect(members.find((m) => m.page_session_id === "p2")!.page_loaded_at).toBe(
      "2024-01-03T00:00:00.000Z",
    );
  });

  it("handles an all-noise window — zero clusters, every member is_noise", () => {
    const args = base_args();
    args.raw = { labels: [-1, -1, -1, -1, -1], probabilities: [0, 0, 0, 0, 0], exemplar_indices: new Map() };
    args.represented = [];
    args.labels = [];
    const { run, clusters, members } = assemble_run_bundle(args);
    expect(clusters).toHaveLength(0);
    expect(run.cluster_count).toBe(0);
    expect(run.noise_count).toBe(5);
    expect(members.every((m) => m.is_noise && m.cluster_id === null)).toBe(true);
  });
});

describe("assemble_run_bundle — fail-loud guards", () => {
  it("throws when the row arrays are misaligned", () => {
    const args = base_args();
    args.vector_versions = ["only-one"];
    expect(() => assemble_run_bundle(args)).toThrow(/misaligned/);
  });

  it("throws when represented and labels lengths disagree", () => {
    const args = base_args();
    args.labels = [];
    expect(() => assemble_run_bundle(args)).toThrow(/index-aligned/);
  });

  it("throws when a clustered row has no represented cluster", () => {
    const args = base_args();
    // row 4 now claims label 7, which no represented cluster covers.
    args.raw = { ...args.raw, labels: [0, 0, 0, -1, 7] };
    expect(() => assemble_run_bundle(args)).toThrow(/no\s+represented cluster/);
  });
});
