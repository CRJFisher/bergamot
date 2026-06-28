import {
  rebuild_clusters,
  default_window_spec,
  type RebuildDeps,
} from "./rebuild_clusters";
import type { StoredPageVector } from "./page_vector_store";
import {
  compute_input_fingerprint,
  compute_params_hash,
  canonical_timestamp,
  DEFAULT_WINDOW_CONFIG,
  DEFAULT_HDBSCAN_CONFIG,
  DEFAULT_PAGE_VECTOR_CONFIG,
  type VisitRow,
  type RunBundle,
  type PersistResult,
} from "@bergamot/tdt";
import type {
  ClusterComputeInput,
  ClusterComputeOutput,
} from "@bergamot/tdt/out/cluster_pipeline";

const MODEL_ID = "bge-small-en-v1.5/q8/384#repr-v1";
const BUILT_AT = "2026-06-10T00:00:00.000Z";

function visit(id: string, url: string, day: number): VisitRow {
  return {
    page_session_id: id,
    url,
    title: `Title ${id}`,
    site_name: null,
    page_loaded_at: new Date(Date.UTC(2026, 5, day, 12, 0, 0)).toISOString(),
    tree_id: "t1",
  };
}

/** N visits in June 2026, all on a clusterable public origin. */
function june_visits(n: number): VisitRow[] {
  return Array.from({ length: n }, (_, i) =>
    visit(`p${i}`, `https://example.com/${i}`, i + 1),
  );
}

function stored(v: VisitRow): StoredPageVector {
  return {
    page_session_id: v.page_session_id,
    vector: Float32Array.from([1, 0, 0]),
    built_at: BUILT_AT,
  };
}

/** A compute fake that puts every page in one cluster — a valid, index-aligned
 *  ClusterComputeOutput the assembler accepts — recording each call. */
function fake_compute(): {
  fn: (input: ClusterComputeInput) => Promise<ClusterComputeOutput>;
  calls: ClusterComputeInput[];
} {
  const calls: ClusterComputeInput[] = [];
  const fn = async (input: ClusterComputeInput): Promise<ClusterComputeOutput> => {
    calls.push(input);
    const n = input.visits.length;
    return {
      labels: Array(n).fill(0),
      probabilities: Array(n).fill(0.9),
      represented: [
        {
          local_label: 0,
          member_indices: Array.from({ length: n }, (_, i) => i),
          representative_index: 0,
          representative_vector: Float32Array.from([1, 0, 0]),
          size: n,
          time_span: {
            start: input.visits[0].page_loaded_at,
            end: input.visits[n - 1].page_loaded_at,
          },
        },
      ],
      cluster_labels: [
        {
          headline_title: "Title p0",
          scope: "example.com",
          keyphrases: [],
          display_label: "Title p0 — example.com",
          representation_version: "det-1",
        },
      ],
      algo_version: "hdbscan-1#clustering-tfjs@0.6.1#tensorflow",
    };
  };
  return { fn, calls };
}

interface Harness {
  deps: RebuildDeps;
  compute_calls: ClusterComputeInput[];
  persisted: RunBundle[];
  vectorise_origins: string[][];
}

function harness(
  visits: VisitRow[],
  overrides: Partial<RebuildDeps> = {},
): Harness {
  const compute = fake_compute();
  const persisted: RunBundle[] = [];
  const vectorise_origins: string[][] = [];

  const deps: RebuildDeps = {
    reader: { list_visits_in_window: async () => visits },
    vectorise: async (origins) => {
      vectorise_origins.push(origins);
    },
    read_vectors: async (ids) =>
      visits.filter((v) => ids.includes(v.page_session_id)).map(stored),
    compute: compute.fn,
    sink: {
      persist: async (bundle): Promise<PersistResult> => {
        persisted.push(bundle);
        return { run_id: bundle.run.id, outcome: "created", superseded_run_ids: [] };
      },
    },
    live_run_fingerprint: async () => null,
    list_never_cluster_origins: async () => [],
    now: () => "2026-06-30T00:00:00.000Z",
    embedding_model_id: MODEL_ID,
    window_config: DEFAULT_WINDOW_CONFIG,
    hdbscan_config: DEFAULT_HDBSCAN_CONFIG,
    page_vector_config: DEFAULT_PAGE_VECTOR_CONFIG,
    ...overrides,
  };
  return { deps, compute_calls: compute.calls, persisted, vectorise_origins };
}

const JUNE: { range_start: string; range_end: string } = {
  range_start: "2026-06-01T00:00:00.000Z",
  range_end: "2026-07-01T00:00:00.000Z",
};

describe("rebuild_clusters", () => {
  it("clusters a window and persists one run through the sink (AC #3)", async () => {
    const visits = june_visits(10);
    const h = harness(visits);

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.windows).toHaveLength(1);
    expect(report.windows[0].status).toBe("clustered");
    expect(h.compute_calls).toHaveLength(1);
    expect(h.persisted).toHaveLength(1);
    // One member row per clustered page (coverage derivable from the bundle).
    expect(h.persisted[0].members).toHaveLength(10);
    expect(h.persisted[0].run.status).toBe("complete");
  });

  it("vectorises ahead of reading and excludes never-cluster origins from the input (AC #8)", async () => {
    const visits = [
      ...june_visits(9),
      visit("bank", "https://mybank.com/account", 15),
    ];
    const h = harness(visits, {
      list_never_cluster_origins: async () => ["mybank.com"],
    });

    await rebuild_clusters(h.deps, JUNE);

    // The embed pass is told to skip the blocked origin.
    expect(h.vectorise_origins).toEqual([["mybank.com"]]);
    // The blocked page never reaches clustering.
    const clustered_ids = h.compute_calls[0].visits.map((v) => v.page_session_id);
    expect(clustered_ids).not.toContain("bank");
    expect(clustered_ids).toHaveLength(9);
  });

  it("skips the re-fit when the live run's inputs are unchanged (AC #6)", async () => {
    const visits = june_visits(10);
    // The fingerprint the orchestrator will compute for this window's inputs.
    const fingerprint = compute_input_fingerprint(
      visits.map((v) => ({
        page_session_id: v.page_session_id,
        embedding_vector_version: BUILT_AT,
      })),
    );

    const h = harness(visits, {
      live_run_fingerprint: async () => fingerprint,
    });

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.windows[0].status).toBe("unchanged");
    // The heavy worker never runs and nothing is persisted — a true no-op.
    expect(h.compute_calls).toHaveLength(0);
    expect(h.persisted).toHaveLength(0);
  });

  it("queries the memoization probe with canonical bounds + the params hash", async () => {
    const visits = june_visits(10);
    const probe_args: Array<[string, string, string]> = [];
    const h = harness(visits, {
      live_run_fingerprint: async (ws, we, ph) => {
        probe_args.push([ws, we, ph]);
        return null;
      },
    });

    await rebuild_clusters(h.deps, JUNE);

    expect(probe_args).toHaveLength(1);
    const [ws, we, ph] = probe_args[0];
    expect(ws).toBe(canonical_timestamp("2026-06-01T00:00:00.000Z"));
    expect(we).toBe(canonical_timestamp("2026-07-01T00:00:00.000Z"));
    expect(ph).toBe(
      compute_params_hash({
        hdbscan: DEFAULT_HDBSCAN_CONFIG,
        window: DEFAULT_WINDOW_CONFIG,
        page_vector: DEFAULT_PAGE_VECTOR_CONFIG,
        matryoshka_dim: null,
      }),
    );
  });

  it("re-fits when the live fingerprint differs (a re-embed bumped built_at)", async () => {
    const visits = june_visits(10);
    const h = harness(visits, {
      live_run_fingerprint: async () => "a-stale-fingerprint",
    });

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.windows[0].status).toBe("clustered");
    expect(h.compute_calls).toHaveLength(1);
    expect(h.persisted).toHaveLength(1);
  });

  it("skips a window with no vectored pages instead of clustering empty", async () => {
    const visits = june_visits(10);
    const h = harness(visits, { read_vectors: async () => [] });

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.windows[0].status).toBe("skipped_no_vectors");
    expect(h.compute_calls).toHaveLength(0);
    expect(h.persisted).toHaveLength(0);
  });

  it("clusters only the pages with cached vectors, keeping versions index-aligned", async () => {
    const visits = june_visits(12);
    // Only the even-indexed pages have an embedded vector; each carries a distinct
    // built_at so a versions/visits misalignment would surface in the fingerprint.
    const vectored = visits.filter((_, i) => i % 2 === 0);
    const built_at_of = new Map(
      vectored.map((v, i) => [
        v.page_session_id,
        `2026-06-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
      ]),
    );
    const probe_args: Array<[string, string, string]> = [];
    const h = harness(visits, {
      read_vectors: async (ids) =>
        vectored
          .filter((v) => ids.includes(v.page_session_id))
          .map((v) => ({
            page_session_id: v.page_session_id,
            vector: Float32Array.from([1, 0, 0]),
            built_at: built_at_of.get(v.page_session_id)!,
          })),
      live_run_fingerprint: async (ws, we, ph) => {
        probe_args.push([ws, we, ph]);
        return null;
      },
    });

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.windows[0].status).toBe("clustered");
    const clustered_ids = h.compute_calls[0].visits.map((v) => v.page_session_id);
    expect(clustered_ids).toEqual(vectored.map((v) => v.page_session_id));
    expect(report.windows[0].input_count).toBe(vectored.length);

    // The memoization fingerprint pairs each kept page with its own built_at —
    // proving the parallel vector_versions array tracks the filtered visits.
    expect(probe_args[0][0]).toBeDefined();
    const expected_fingerprint = compute_input_fingerprint(
      vectored.map((v) => ({
        page_session_id: v.page_session_id,
        embedding_vector_version: built_at_of.get(v.page_session_id)!,
      })),
    );
    const h2 = harness(visits, {
      read_vectors: h.deps.read_vectors,
      live_run_fingerprint: async () => expected_fingerprint,
    });
    const report2 = await rebuild_clusters(h2.deps, JUNE);
    expect(report2.windows[0].status).toBe("unchanged");
  });

  it("reports total visits before exclusion and the excluded-origin count", async () => {
    const visits = [
      ...june_visits(9),
      visit("bank", "https://mybank.com/account", 15),
    ];
    const h = harness(visits, {
      list_never_cluster_origins: async () => ["mybank.com"],
    });

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.total_visits).toBe(10);
    expect(report.excluded_origins).toBe(1);
    expect(report.range_start).toBe(JUNE.range_start);
    expect(report.range_end).toBe(JUNE.range_end);
  });

  it("marks a too-sparse window as skipped (below min_window_visits)", async () => {
    const visits = june_visits(3); // < DEFAULT_WINDOW_CONFIG.min_window_visits (8)
    const h = harness(visits);

    const report = await rebuild_clusters(h.deps, JUNE);

    expect(report.windows[0].status).toBe("skipped_sparse");
    expect(h.compute_calls).toHaveLength(0);
  });
});

describe("default_window_spec", () => {
  it("spans the start of the previous calendar month through now", () => {
    const spec = default_window_spec(new Date("2026-06-26T09:30:00.000Z"));
    expect(spec.range_start).toBe("2026-05-01T00:00:00.000Z");
    expect(spec.range_end).toBe("2026-06-26T09:30:00.000Z");
  });

  it("wraps the year at January", () => {
    const spec = default_window_spec(new Date("2026-01-15T00:00:00.000Z"));
    expect(spec.range_start).toBe("2025-12-01T00:00:00.000Z");
  });
});
