import {
  build_grid,
  reduce_pca50,
  run_window_cell,
  run_sweep,
  check_known_project_recovery,
  evaluate_guardrail,
  run_pca_promotion,
  redownload_volume,
} from "./sweep";
import type { GridCell, KnownProject } from "./types";
import type { HdbscanRaw } from "../types";
import {
  two_cluster_window,
  all_noise_window,
  high_dim_window,
  multi_window_set,
  TWO_CLUSTER_KNOWN_PROJECT,
} from "./__fixtures__/windows";
import { FakeVectorStore } from "../fakes";

const MAX_SAMPLES = 4000;

function l2_norm(v: Float32Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

describe("build_grid", () => {
  it("enumerates 108 cells with method fixed at eom", () => {
    const grid = build_grid();
    expect(grid).toHaveLength(6 * 3 * 3 * 2);
    expect(grid.every((c) => c.method === "eom")).toBe(true);
    // reduction is the outermost axis: the first 54 are raw, the last 54 pca50.
    expect(grid.slice(0, 54).every((c) => c.reduction === "raw")).toBe(true);
    expect(grid.slice(54).every((c) => c.reduction === "pca50")).toBe(true);
  });
});

describe("reduce_pca50", () => {
  it("reduces a high-dim window to unit-norm rows", () => {
    const window = high_dim_window();
    const reduced = reduce_pca50(window.vectors);
    expect(reduced).toHaveLength(window.vectors.length);
    const dim = window.vectors[0].vector.length;
    const expected_components = Math.min(50, window.vectors.length - 1, dim);
    for (const r of reduced) {
      expect(r.vector.length).toBe(expected_components);
      expect(l2_norm(r.vector)).toBeCloseTo(1, 5);
    }
  });

  it("preserves row order and page_session_id", () => {
    const window = high_dim_window();
    const reduced = reduce_pca50(window.vectors);
    for (let i = 0; i < reduced.length; i++) {
      expect(reduced[i].page_session_id).toBe(window.vectors[i].page_session_id);
    }
  });

  it("is deterministic for a fixed random_state", () => {
    const window = high_dim_window();
    const a = reduce_pca50(window.vectors, 7);
    const b = reduce_pca50(window.vectors, 7);
    for (let i = 0; i < a.length; i++) {
      expect(Array.from(a[i].vector)).toEqual(Array.from(b[i].vector));
    }
  });

  it("is a no-op for a window of one page", () => {
    const window = high_dim_window();
    const one = [window.vectors[0]];
    expect(reduce_pca50(one)).toBe(one);
  });
});

describe("run_window_cell", () => {
  const cell = (reduction: GridCell["reduction"]): GridCell => ({
    min_cluster_size: 3,
    min_samples: 3,
    epsilon: 0,
    method: "eom",
    reduction,
  });

  it("clusters a two-group window into clusters with low noise (raw)", async () => {
    const window = two_cluster_window();
    const ws = await run_window_cell(window, cell("raw"), MAX_SAMPLES, null);
    expect(ws.score.n).toBe(window.vectors.length);
    expect(ws.score.cluster_count).toBeGreaterThanOrEqual(1);
    expect(ws.score.noise_fraction).toBeLessThan(0.5);
  });

  it("runs the same window through the pca50 path", async () => {
    const window = high_dim_window();
    const ws = await run_window_cell(window, cell("pca50"), MAX_SAMPLES, null);
    expect(ws.score.n).toBe(window.vectors.length);
    expect(ws.cell.reduction).toBe("pca50");
  });
});

describe("run_sweep determinism", () => {
  it("yields identical results across two runs", async () => {
    const windows = [two_cluster_window()];
    const opts = { max_samples: MAX_SAMPLES };
    const a = await run_sweep(windows, opts);
    const b = await run_sweep(windows, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(108);
  });
});

describe("check_known_project_recovery", () => {
  const window = two_cluster_window();
  const known: KnownProject = { page_session_ids: TWO_CLUSTER_KNOWN_PROJECT };

  it("is true when the labeled project lands predominantly in one cluster", async () => {
    const ws = await run_window_cell(
      window,
      { min_cluster_size: 3, min_samples: 3, epsilon: 0, method: "eom", reduction: "raw" },
      MAX_SAMPLES,
      known,
    );
    expect(ws.known_project_recovered).toBe(true);
  });

  it("is false when every project page is noise", () => {
    const raw: HdbscanRaw = {
      labels: window.visits.map(() => -1),
      probabilities: window.visits.map(() => 0),
      exemplar_indices: new Map(),
    };
    expect(check_known_project_recovery(raw, window, known)).toBe(false);
  });

  it("is false for an empty known set", () => {
    const raw: HdbscanRaw = {
      labels: window.visits.map(() => 0),
      probabilities: window.visits.map(() => 1),
      exemplar_indices: new Map(),
    };
    expect(check_known_project_recovery(raw, window, { page_session_ids: [] })).toBe(false);
  });
});

describe("evaluate_guardrail", () => {
  it("does not trip on a healthy two-cluster window", async () => {
    const results = await run_sweep([two_cluster_window()], {
      max_samples: MAX_SAMPLES,
      known_project: { page_session_ids: TWO_CLUSTER_KNOWN_PROJECT },
    });
    const verdict = evaluate_guardrail(results);
    expect(verdict.tripped).toBe(false);
    expect(verdict.reason).toBe("healthy");
    expect(verdict.promotion).toBeNull();
  });

  it("trips on an all-noise window and exercises the PCA-promotion path", async () => {
    const results = await run_sweep([all_noise_window()], { max_samples: MAX_SAMPLES });
    const verdict = evaluate_guardrail(results);
    expect(verdict.tripped).toBe(true);
    expect(verdict.reason).toBe("noise_persistent");
    // "Exercised" = the promotion path ran and produced a verdict — NOT that PCA wins.
    expect(verdict.promotion).not.toBeNull();
    expect(typeof verdict.promotion!.pca_improves).toBe("boolean");
  });
});

describe("run_pca_promotion", () => {
  it("compares the default-params raw and pca50 cells", async () => {
    const results = await run_sweep(multi_window_set(), { max_samples: MAX_SAMPLES });
    const verdict = run_pca_promotion(results);
    expect(verdict.raw_mean_noise_fraction).toBeGreaterThanOrEqual(0);
    expect(verdict.pca_mean_noise_fraction).toBeGreaterThanOrEqual(0);
    expect(typeof verdict.pca_improves).toBe("boolean");
  });
});

describe("redownload_volume", () => {
  it("counts only window pages absent from the vector cache", async () => {
    const store = new FakeVectorStore();
    const model = "bge-small-en@384#repr-v1";
    await store.put("p1", model, "title_plus_lead", new Float32Array([1]));
    await store.put("p2", model, "title_plus_lead", new Float32Array([1]));
    const missing = await redownload_volume(["p1", "p2", "p3", "p4"], model, store);
    expect(missing).toBe(2); // p3, p4 are uncached
  });
});
