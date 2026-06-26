import {
  canonical_json,
  canonical_timestamp,
  canonical_params_json,
  compute_params_hash,
  compute_run_id,
  compute_cluster_id,
  compute_input_fingerprint,
  type ResolvedParams,
  type RunNaturalKey,
} from "./run_keying";
import {
  DEFAULT_HDBSCAN_CONFIG,
  DEFAULT_WINDOW_CONFIG,
  DEFAULT_PAGE_VECTOR_CONFIG,
} from "./config";

const PARAMS: ResolvedParams = {
  hdbscan: DEFAULT_HDBSCAN_CONFIG,
  window: DEFAULT_WINDOW_CONFIG,
  page_vector: DEFAULT_PAGE_VECTOR_CONFIG,
  matryoshka_dim: null,
};

const KEY: RunNaturalKey = {
  window_start: "2024-01-01T00:00:00Z",
  window_end: "2024-02-01T00:00:00Z",
  params_hash: compute_params_hash(PARAMS),
  embedding_model_id: "bge-small-en-v1.5/q8/384#repr-v1",
  algo_version: "hdbscan-1#clustering-tfjs@0.6.1#wasm",
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

describe("canonical_json", () => {
  it("sorts object keys recursively, so key order does not affect output", () => {
    const a = canonical_json({ b: 1, a: { d: 4, c: 3 } });
    const b = canonical_json({ a: { c: 3, d: 4 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it("renders 0.1, 0.10 and 1e-1 identically", () => {
    expect(canonical_json(0.1)).toBe(canonical_json(0.1));
    expect(canonical_json(0.1)).toBe(canonical_json(1e-1));
    expect(canonical_json(0.5)).toBe(canonical_json(5e-1));
  });

  it("collapses -0 to 0", () => {
    expect(canonical_json(-0)).toBe(canonical_json(0));
    expect(canonical_json(-0)).toBe("0");
  });

  it("throws on a non-finite number rather than emitting null", () => {
    expect(() => canonical_json(NaN)).toThrow(/non-finite/);
    expect(() => canonical_json(Infinity)).toThrow(/non-finite/);
    expect(() => canonical_json(-Infinity)).toThrow(/non-finite/);
  });
});

describe("canonical_timestamp", () => {
  it("normalizes equivalent ISO forms to one UTC millisecond form", () => {
    expect(canonical_timestamp("2024-01-01T00:00:00Z")).toBe(
      "2024-01-01T00:00:00.000Z",
    );
    expect(canonical_timestamp("2024-01-01T00:00:00+00:00")).toBe(
      "2024-01-01T00:00:00.000Z",
    );
    expect(canonical_timestamp("2024-01-01T01:00:00+01:00")).toBe(
      "2024-01-01T00:00:00.000Z",
    );
  });

  it("throws on an unparseable timestamp", () => {
    expect(() => canonical_timestamp("not-a-date")).toThrow();
  });
});

describe("compute_params_hash / canonical_params_json", () => {
  it("is a sha256 hex digest", () => {
    expect(compute_params_hash(PARAMS)).toMatch(SHA256_HEX);
  });

  it("is invariant to the key insertion order of the params object", () => {
    const reordered: ResolvedParams = {
      matryoshka_dim: null,
      page_vector: DEFAULT_PAGE_VECTOR_CONFIG,
      hdbscan: DEFAULT_HDBSCAN_CONFIG,
      window: DEFAULT_WINDOW_CONFIG,
    };
    expect(compute_params_hash(reordered)).toBe(compute_params_hash(PARAMS));
    expect(canonical_params_json(reordered)).toBe(canonical_params_json(PARAMS));
  });

  it("changes when an HDBSCAN param changes", () => {
    const changed: ResolvedParams = {
      ...PARAMS,
      hdbscan: { ...DEFAULT_HDBSCAN_CONFIG, min_samples: 8 },
    };
    expect(compute_params_hash(changed)).not.toBe(compute_params_hash(PARAMS));
  });

  it("changes when the windowing policy changes", () => {
    const changed: ResolvedParams = {
      ...PARAMS,
      window: { ...DEFAULT_WINDOW_CONFIG, max_samples: 2000 },
    };
    expect(compute_params_hash(changed)).not.toBe(compute_params_hash(PARAMS));
  });

  it("changes when the pooling strategy changes", () => {
    const changed: ResolvedParams = {
      ...PARAMS,
      page_vector: { ...DEFAULT_PAGE_VECTOR_CONFIG, segment_chars: 800 },
    };
    expect(compute_params_hash(changed)).not.toBe(compute_params_hash(PARAMS));
  });

  it("changes when the matryoshka dim changes", () => {
    const changed: ResolvedParams = { ...PARAMS, matryoshka_dim: 50 };
    expect(compute_params_hash(changed)).not.toBe(compute_params_hash(PARAMS));
  });
});

describe("compute_run_id", () => {
  it("is a sha256 hex digest", () => {
    expect(compute_run_id(KEY)).toMatch(SHA256_HEX);
  });

  it("is stable for logically-identical keys (repeated calls match)", () => {
    expect(compute_run_id(KEY)).toBe(compute_run_id({ ...KEY }));
  });

  it("is invariant to equivalent timestamp formatting", () => {
    const equivalent: RunNaturalKey = {
      ...KEY,
      window_start: "2024-01-01T00:00:00.000+00:00",
    };
    expect(compute_run_id(equivalent)).toBe(compute_run_id(KEY));
  });

  it.each([
    ["window_start", { window_start: "2024-03-01T00:00:00Z" }],
    ["window_end", { window_end: "2024-03-01T00:00:00Z" }],
    ["params_hash", { params_hash: "deadbeef" }],
    ["embedding_model_id", { embedding_model_id: "gte-small/q8/384#repr-v1" }],
    ["algo_version", { algo_version: "hdbscan-1#clustering-tfjs@0.6.1#tfjs-node" }],
  ])("changes when %s changes", (_label, patch) => {
    expect(compute_run_id({ ...KEY, ...patch })).not.toBe(compute_run_id(KEY));
  });
});

describe("compute_cluster_id", () => {
  const run_id = compute_run_id(KEY);

  it("is a sha256 hex digest", () => {
    expect(compute_cluster_id(run_id, 0)).toMatch(SHA256_HEX);
  });

  it("is stable for a (run_id, local_label) pair", () => {
    expect(compute_cluster_id(run_id, 2)).toBe(compute_cluster_id(run_id, 2));
  });

  it("is distinct per local_label within a run", () => {
    const ids = new Set([0, 1, 2].map((l) => compute_cluster_id(run_id, l)));
    expect(ids.size).toBe(3);
  });

  it("is distinct across runs for the same local_label", () => {
    const other = compute_run_id({ ...KEY, window_start: "2024-05-01T00:00:00Z" });
    expect(compute_cluster_id(run_id, 0)).not.toBe(compute_cluster_id(other, 0));
  });
});

describe("compute_input_fingerprint", () => {
  const base = [
    { page_session_id: "p2", embedding_vector_version: "2024-01-02T00:00:00Z" },
    { page_session_id: "p1", embedding_vector_version: "2024-01-01T00:00:00Z" },
    { page_session_id: "p3", embedding_vector_version: "2024-01-03T00:00:00Z" },
  ];

  it("is a sha256 hex digest", () => {
    expect(compute_input_fingerprint(base)).toMatch(SHA256_HEX);
  });

  it("is order-independent (a shuffled input list hashes identically)", () => {
    const shuffled = [base[1], base[2], base[0]];
    expect(compute_input_fingerprint(shuffled)).toBe(
      compute_input_fingerprint(base),
    );
  });

  it("changes when a page is re-embedded (version bumps)", () => {
    const reembedded = base.map((e) =>
      e.page_session_id === "p2"
        ? { ...e, embedding_vector_version: "2024-06-01T00:00:00Z" }
        : e,
    );
    expect(compute_input_fingerprint(reembedded)).not.toBe(
      compute_input_fingerprint(base),
    );
  });

  it("changes when a late-arriving visit is added to the window", () => {
    const withLate = [
      ...base,
      { page_session_id: "p4", embedding_vector_version: "2024-01-04T00:00:00Z" },
    ];
    expect(compute_input_fingerprint(withLate)).not.toBe(
      compute_input_fingerprint(base),
    );
  });

  it("changes when a visit drops out of the window", () => {
    const fewer = base.filter((e) => e.page_session_id !== "p3");
    expect(compute_input_fingerprint(fewer)).not.toBe(
      compute_input_fingerprint(base),
    );
  });
});
