import {
  build_page_vector,
  resolve_page_vector,
  dedupe_visits,
} from "./page_vectors";
import { DEFAULT_PAGE_VECTOR_CONFIG, type PageVectorConfig } from "./config";
import type { PageContent, PageRepr, VisitRow } from "./types";
import type { EmbedFn } from "./ports";
import { FakeVectorStore, create_deterministic_embed } from "./fakes";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function make_content(
  page_session_id: string,
  title: string,
  content: string,
): PageContent {
  return { page_session_id, title, content };
}

function t(y: number, mo: number, d: number, h = 0, min = 0, s = 0): string {
  return new Date(Date.UTC(y, mo - 1, d, h, min, s)).toISOString();
}

function make_visit(
  page_session_id: string,
  url: string,
  tree_id: string,
  page_loaded_at: string,
): VisitRow {
  return {
    page_session_id,
    url,
    title: null,
    site_name: null,
    page_loaded_at,
    tree_id,
  };
}

// Byte-level equality — the only assertion strong enough for the determinism AC
// (toEqual does a numeric compare and would pass on a -0/+0 difference).
function bytes(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
function bytes_equal(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && bytes(a).equals(bytes(b));
}
function l2(v: Float32Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

// A scripted embed for precise per-segment control: maps exact text → vector,
// throws on an unmapped key so a test that mispredicts segmentation fails loud.
function scripted_embed(map: Record<string, number[]>): {
  embed: EmbedFn;
  embedded_texts: string[];
} {
  const embedded_texts: string[] = [];
  const embed: EmbedFn = async (text: string) => {
    embedded_texts.push(text);
    const vec = map[text];
    if (!vec) throw new Error(`scripted_embed: unmapped text ${JSON.stringify(text)}`);
    return Float32Array.from(vec);
  };
  return { embed, embedded_texts };
}

// Small segment budget so guard fixtures can craft exact segments by hand.
const TINY: PageVectorConfig = {
  ...DEFAULT_PAGE_VECTOR_CONFIG,
  segment_chars: 4,
  lead_chars: 4,
};

const EXTRACT: PageRepr = "main_content_extract";
const LEAD: PageRepr = "title_plus_lead";
const MODEL = "test-model@8#repr-v1";

// ---------------------------------------------------------------------------
// No-text exclusion (AC #3)
// ---------------------------------------------------------------------------

describe("build_page_vector — no-text exclusion", () => {
  it("returns null and never embeds when title and content are empty", async () => {
    const { embed, embedded_texts } = scripted_embed({});
    const v = await build_page_vector(
      make_content("p", "", ""),
      embed,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(v).toBeNull();
    expect(embedded_texts).toHaveLength(0);
  });

  it("treats whitespace / zero-width-only text as no-text", async () => {
    const { embed, embedded_texts } = scripted_embed({});
    const v = await build_page_vector(
      make_content("p", "\u00A0\t\n", "\u2009\uFEFF \u00A0"),
      embed,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(v).toBeNull();
    expect(embedded_texts).toHaveLength(0);
  });

  it("builds from title alone when content is empty", async () => {
    const { embed } = create_deterministic_embed();
    const v = await build_page_vector(
      make_content("p", "Rust ownership", ""),
      embed,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(v).not.toBeNull();
    expect(v!.low_confidence).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Guards: dispersion, cohesion, degenerate (AC #3)
// ---------------------------------------------------------------------------

describe("build_page_vector — guards", () => {
  it("flags low_confidence and uses the dominant segment on dispersion", async () => {
    // "aaaabbbb" → segments ["aaaa","bbbb"] mapped to orthogonal axes.
    const { embed } = scripted_embed({ aaaa: [1, 0], bbbb: [0, 1] });
    const v = await build_page_vector(
      make_content("p", "", "aaaabbbb"),
      embed,
      EXTRACT,
      TINY,
    );
    expect(v).not.toBeNull();
    expect(v!.low_confidence).toBe(true);
    // medoid ties (both score 0) → lowest index → "aaaa" → [1,0] normalized.
    expect(bytes_equal(v!.vector, Float32Array.from([1, 0]))).toBe(true);
  });

  it("pools and stays confident when segments cohere", async () => {
    const { embed } = scripted_embed({ aaaa: [1, 0], bbbb: [2, 0] });
    const v = await build_page_vector(
      make_content("p", "", "aaaabbbb"),
      embed,
      EXTRACT,
      TINY,
    );
    expect(v).not.toBeNull();
    expect(v!.low_confidence).toBe(false);
    // mean([1,0],[2,0]) = [1.5,0] → normalized [1,0].
    expect(v!.vector[0]).toBeCloseTo(1, 6);
    expect(v!.vector[1]).toBeCloseTo(0, 6);
  });

  it("excludes a single segment whose embedding is all-zero (degenerate)", async () => {
    const { embed } = scripted_embed({ aaaa: [0, 0] });
    const v = await build_page_vector(
      make_content("p", "", "aaaa"),
      embed,
      EXTRACT,
      TINY,
    );
    expect(v).toBeNull();
  });

  it("throws on an embedder that returns inconsistent dimensions", async () => {
    const { embed } = scripted_embed({ aaaa: [1, 0], bbbb: [1, 0, 0] });
    await expect(
      build_page_vector(make_content("p", "", "aaaabbbb"), embed, EXTRACT, TINY),
    ).rejects.toThrow(/dim mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Segmentation, pooling, normalization
// ---------------------------------------------------------------------------

describe("build_page_vector — segmentation & normalization", () => {
  it("segments content by the code-point budget", async () => {
    const { embed, embedded_texts } = scripted_embed({
      aaaa: [1, 0],
      bbbb: [1, 0],
      cc: [1, 0],
    });
    await build_page_vector(make_content("p", "", "aaaabbbbcc"), embed, EXTRACT, TINY);
    expect(embedded_texts).toEqual(["aaaa", "bbbb", "cc"]);
  });

  it("segments on code-point boundaries, never splitting a surrogate pair", async () => {
    // "ab🌍cd" = 5 code points; segment_chars=4 → ["ab🌍c","d"] (emoji intact).
    // A UTF-16-offset split would instead yield ["ab🌍","cd"] (different) or a
    // lone surrogate; the scripted embed throws on any unmapped segment.
    const { embed, embedded_texts } = scripted_embed({ "ab🌍c": [1, 0], d: [1, 0] });
    await build_page_vector(make_content("p", "", "ab🌍cd"), embed, EXTRACT, TINY);
    expect(embedded_texts).toEqual(["ab🌍c", "d"]);
  });

  it("title_plus_lead truncates the lead to the code-point budget", async () => {
    // lead_chars=4 → body lead is "abcd"; title "" → text "abcd" (one segment).
    const { embed, embedded_texts } = scripted_embed({ abcd: [3, 4] });
    const v = await build_page_vector(
      make_content("p", "", "abcdefghij"),
      embed,
      LEAD,
      TINY,
    );
    expect(embedded_texts).toEqual(["abcd"]);
    expect(l2(v!.vector)).toBeCloseTo(1, 6); // [3,4] normalized → unit
  });

  it("returns a unit-norm vector for any non-null build", async () => {
    const { embed } = create_deterministic_embed();
    const v = await build_page_vector(
      make_content("p", "Title", "some body text"),
      embed,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(l2(v!.vector)).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// Determinism (AC #4)
// ---------------------------------------------------------------------------

describe("build_page_vector — determinism", () => {
  it("yields bitwise-identical bytes on repeat", async () => {
    const c = make_content("p", "Distributed systems", "consensus and raft logs ".repeat(40));
    const a = await build_page_vector(c, create_deterministic_embed().embed, EXTRACT, DEFAULT_PAGE_VECTOR_CONFIG);
    const b = await build_page_vector(c, create_deterministic_embed().embed, EXTRACT, DEFAULT_PAGE_VECTOR_CONFIG);
    expect(bytes_equal(a!.vector, b!.vector)).toBe(true);
  });

  it("is independent of the order pages are processed", async () => {
    const contents = [
      make_content("a", "Alpha", "alpha body ".repeat(30)),
      make_content("b", "Beta", "beta body ".repeat(30)),
      make_content("c", "Gamma", "gamma body ".repeat(30)),
    ];
    const build = (c: PageContent) =>
      build_page_vector(c, create_deterministic_embed().embed, EXTRACT, DEFAULT_PAGE_VECTOR_CONFIG);

    const forward = new Map<string, Float32Array>();
    for (const c of contents) forward.set(c.page_session_id, (await build(c))!.vector);

    const reverse = new Map<string, Float32Array>();
    for (const c of [...contents].reverse()) reverse.set(c.page_session_id, (await build(c))!.vector);

    for (const c of contents) {
      expect(bytes_equal(forward.get(c.page_session_id)!, reverse.get(c.page_session_id)!)).toBe(true);
    }
  });

  it("handles multibyte content identically across runs", async () => {
    const c = make_content("p", "日本語", "🌍 emoji and café and 文字 ".repeat(50));
    const a = await build_page_vector(c, create_deterministic_embed().embed, EXTRACT, DEFAULT_PAGE_VECTOR_CONFIG);
    const b = await build_page_vector(c, create_deterministic_embed().embed, EXTRACT, DEFAULT_PAGE_VECTOR_CONFIG);
    expect(bytes_equal(a!.vector, b!.vector)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Caching & invalidation (AC #2)
// ---------------------------------------------------------------------------

describe("resolve_page_vector — caching", () => {
  it("returns the stored vector on a hit without embedding", async () => {
    const store = new FakeVectorStore();
    const stored = Float32Array.from([1, 0, 0]);
    await store.put("p", MODEL, "main_content_extract", stored);
    const { embed, embedded_texts } = create_deterministic_embed();

    const got = await resolve_page_vector(
      make_content("p", "ignored", "ignored"),
      embed,
      store,
      MODEL,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(bytes_equal(got!, stored)).toBe(true);
    expect(embedded_texts).toHaveLength(0);
  });

  it("builds, persists, and returns on a miss", async () => {
    const store = new FakeVectorStore();
    const { embed, embedded_texts } = create_deterministic_embed();
    const got = await resolve_page_vector(
      make_content("p", "Title", "body text"),
      embed,
      store,
      MODEL,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(got).not.toBeNull();
    expect(embedded_texts.length).toBeGreaterThan(0);
    expect(bytes_equal((await store.get("p", MODEL))!, got!)).toBe(true);
  });

  it("caches nothing when the build is excluded (null)", async () => {
    const store = new FakeVectorStore();
    const { embed } = create_deterministic_embed();
    const got = await resolve_page_vector(
      make_content("p", "", ""),
      embed,
      store,
      MODEL,
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(got).toBeNull();
    expect(await store.get("p", MODEL)).toBeNull();
  });

  it("treats a different model id as a miss and rebuilds (invalidation)", async () => {
    const store = new FakeVectorStore();
    const old = Float32Array.from([0, 1, 0]);
    await store.put("p", "model-a@8#repr-v1", "main_content_extract", old);
    const { embed, embedded_texts } = create_deterministic_embed();

    const got = await resolve_page_vector(
      make_content("p", "Title", "body"),
      embed,
      store,
      "model-b@16#repr-v1",
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(embedded_texts.length).toBeGreaterThan(0); // had to rebuild
    expect(bytes_equal((await store.get("p", "model-a@8#repr-v1"))!, old)).toBe(true); // old intact
    expect(bytes_equal((await store.get("p", "model-b@16#repr-v1"))!, got!)).toBe(true);
  });

  it("treats a bumped repr version in the model id as a miss", async () => {
    const store = new FakeVectorStore();
    await store.put("p", "bge@384#repr-v1", "main_content_extract", Float32Array.from([1, 0]));
    const { embed, embedded_texts } = create_deterministic_embed();
    await resolve_page_vector(
      make_content("p", "Title", "body"),
      embed,
      store,
      "bge@384#repr-v2",
      EXTRACT,
      DEFAULT_PAGE_VECTOR_CONFIG,
    );
    expect(embedded_texts.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dedup (AC #5)
// ---------------------------------------------------------------------------

describe("dedupe_visits", () => {
  it("collapses repeat same-url visits within one tree, keeping the earliest", async () => {
    const visits = [
      make_visit("v1", "https://x.com/a", "tree-1", t(2024, 1, 1, 9)),
      make_visit("v2", "https://x.com/a", "tree-1", t(2024, 1, 1, 10)),
    ];
    const out = dedupe_visits(visits);
    expect(out).toHaveLength(1);
    expect(out[0].page_session_id).toBe("v1"); // earliest survives
  });

  it("keeps same-url visits in different trees", async () => {
    const visits = [
      make_visit("v1", "https://x.com/a", "tree-1", t(2024, 1, 1, 9)),
      make_visit("v2", "https://x.com/a", "tree-2", t(2024, 1, 1, 10)),
    ];
    expect(dedupe_visits(visits)).toHaveLength(2);
  });

  it("preserves input order and is the identity when no duplicates exist", async () => {
    const visits = [
      make_visit("v1", "https://x.com/a", "tree-1", t(2024, 1, 1, 9)),
      make_visit("v2", "https://x.com/b", "tree-1", t(2024, 1, 1, 10)),
      make_visit("v3", "https://x.com/c", "tree-2", t(2024, 1, 1, 11)),
    ];
    expect(dedupe_visits(visits)).toEqual(visits);
  });

  it("does not mutate the input", async () => {
    const visits = [
      make_visit("v1", "https://x.com/a", "tree-1", t(2024, 1, 1, 9)),
      make_visit("v2", "https://x.com/a", "tree-1", t(2024, 1, 1, 10)),
    ];
    const snapshot = visits.map((v) => v.page_session_id);
    dedupe_visits(visits);
    expect(visits.map((v) => v.page_session_id)).toEqual(snapshot);
  });

  it("handles empty input", async () => {
    expect(dedupe_visits([])).toEqual([]);
  });

  it("is order-driven: keeps the first row in array order, not the earliest timestamp", async () => {
    // Pins the documented contract — dedupe does NOT sort/compare timestamps; it
    // keeps whichever (tree_id,url) appears first. Fed deliberately out of time
    // order, the array-first row survives (the sorted-input contract is what
    // makes "first" == "earliest" in production).
    const visits = [
      make_visit("v_late", "https://x.com/a", "tree-1", t(2024, 1, 1, 10)),
      make_visit("v_early", "https://x.com/a", "tree-1", t(2024, 1, 1, 9)),
    ];
    const out = dedupe_visits(visits);
    expect(out).toHaveLength(1);
    expect(out[0].page_session_id).toBe("v_late");
  });
});
