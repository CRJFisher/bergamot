import { getDomain } from "tldts";
import { DuckDB, create_metadata_schema } from "../duck_db";
import { DEFAULT_PAGE_VECTOR_CONFIG } from "@bergamot/tdt";
import type { EmbedFn } from "@bergamot/tdt";
import type { ContentCorpus, CorpusContent, CorpusEntry } from "../redownload/corpus";
import { PageVectorStore } from "./page_vector_store";
import { run_embed_pass } from "./embed_pass";

const MODEL_A = "bge-small-en-v1.5/q8/384#repr-v1";
const MODEL_B = "gte-small/q8/384#repr-v1";
const REPR = "main_content_extract";
const DIM = 8;

function corpus_content(id: string, content: string): CorpusContent {
  return {
    page_session_id: id,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    content,
    site_name: null,
    author: null,
    published_at: null,
    lang: "en",
    fetched_at: "2026-06-09T12:00:00Z",
    http_status: 200,
    content_hash: `hash-${id}`,
  };
}

/** Yields a fixed list of public pages, dropping never-cluster origins BEFORE
 *  emitting (mirroring the production corpus, which drops them before fetch).
 *  get_content is unused by the pass. */
class FakeCorpus implements ContentCorpus {
  constructor(private readonly pages: CorpusContent[]) {}
  async get_content(_id: string): Promise<CorpusEntry | null> {
    throw new Error("not used by the embed pass");
  }
  async *iter_public_pages(
    exclude_origins: ReadonlySet<string> = new Set(),
  ): AsyncIterable<CorpusContent> {
    for (const page of this.pages) {
      const domain = getDomain(page.url);
      if (domain !== null && exclude_origins.has(domain)) continue;
      yield page;
    }
  }
}

interface CountingEmbed {
  embed: EmbedFn;
  /** The text of every segment embedded, in call order. */
  calls: string[];
}

/**
 * Content-dependent embedder over `dim` components, recording every call.
 * `behavior` can force a degenerate (all-zero) vector or a throw for segments
 * whose text contains a marker, to exercise the exclusion / isolation paths.
 */
function counting_embed(
  behavior: { zero_if?: string; throw_if?: string } = {},
): CountingEmbed {
  const calls: string[] = [];
  const embed: EmbedFn = async (text: string) => {
    calls.push(text);
    if (behavior.throw_if && text.includes(behavior.throw_if)) {
      throw new Error("embed boom");
    }
    const v = new Float32Array(DIM);
    if (behavior.zero_if && text.includes(behavior.zero_if)) return v; // all zeros
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
    for (let d = 0; d < DIM; d++) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      v[d] = (h / 0xffffffff) * 2 - 1;
    }
    return v;
  };
  return { embed, calls };
}

describe("run_embed_pass", () => {
  let db: DuckDB;
  let store: PageVectorStore;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
    store = new PageVectorStore(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("vectorises every public page on a first pass (build-on-miss)", async () => {
    const corpus = new FakeCorpus([
      corpus_content("p1", "alpha content"),
      corpus_content("p2", "beta content"),
      corpus_content("p3", "gamma content"),
    ]);
    const { embed } = counting_embed();

    const report = await run_embed_pass(corpus, store, embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report).toEqual({ scanned: 3, embedded: 3, skipped: 0, excluded: 0, failed: 0 });
    for (const id of ["p1", "p2", "p3"]) {
      const v = await store.get(id, MODEL_A);
      expect(v).not.toBeNull();
      expect(v!.length).toBe(DIM);
    }
  });

  it("skips a page already vectorised under the current model id (no re-embed)", async () => {
    const corpus = new FakeCorpus([
      corpus_content("p1", "alpha content"),
      corpus_content("p2", "beta content"),
    ]);
    // Pre-seed p1's vector under MODEL_A.
    await store.put("p1", MODEL_A, REPR, new Float32Array(DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0)));

    const { embed, calls } = counting_embed();
    const report = await run_embed_pass(corpus, store, embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report).toEqual({ scanned: 2, embedded: 1, skipped: 1, excluded: 0, failed: 0 });
    // p1's text is never embedded; only p2 is.
    expect(calls.some((t) => t.includes("alpha"))).toBe(false);
    expect(calls.some((t) => t.includes("beta"))).toBe(true);
  });

  it("is incremental: a second pass over an unchanged corpus embeds nothing", async () => {
    const corpus = new FakeCorpus([corpus_content("p1", "alpha"), corpus_content("p2", "beta")]);

    await run_embed_pass(corpus, store, counting_embed().embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);
    const second = counting_embed();
    const report = await run_embed_pass(corpus, store, second.embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report).toEqual({ scanned: 2, embedded: 0, skipped: 2, excluded: 0, failed: 0 });
    expect(second.calls).toHaveLength(0);
  });

  it("re-embeds under a new embedding_model_id (clean miss), keeping the old", async () => {
    const corpus = new FakeCorpus([corpus_content("p1", "alpha")]);

    await run_embed_pass(corpus, store, counting_embed().embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);
    const second = counting_embed();
    const report = await run_embed_pass(corpus, store, second.embed, MODEL_B, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report).toEqual({ scanned: 1, embedded: 1, skipped: 0, excluded: 0, failed: 0 });
    expect(second.calls.length).toBeGreaterThan(0); // it DID re-embed
    expect(await store.get("p1", MODEL_A)).not.toBeNull();
    expect(await store.get("p1", MODEL_B)).not.toBeNull();
  });

  it("excludes a no-text page — nothing is stored (AC #7)", async () => {
    // A page with no extractable text: blank title and blank content.
    const blank: CorpusContent = { ...corpus_content("empty", ""), title: "" };
    const corpus = new FakeCorpus([blank, corpus_content("ok", "real content")]);

    const report = await run_embed_pass(corpus, store, counting_embed().embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report.excluded).toBe(1);
    expect(report.embedded).toBe(1);
    expect(await store.get("empty", MODEL_A)).toBeNull();
    expect(await store.get("ok", MODEL_A)).not.toBeNull();
  });

  it("excludes a page whose embedding is degenerate — no zero vector stored (AC #7)", async () => {
    const corpus = new FakeCorpus([corpus_content("zero", "zeroes here"), corpus_content("ok", "real")]);
    const { embed } = counting_embed({ zero_if: "zeroes" });

    const report = await run_embed_pass(corpus, store, embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report.excluded).toBe(1);
    expect(await store.get("zero", MODEL_A)).toBeNull();
    expect(await store.get("ok", MODEL_A)).not.toBeNull();
  });

  it("isolates a per-page embed failure and continues the pass", async () => {
    const corpus = new FakeCorpus([
      corpus_content("p1", "good one"),
      corpus_content("p2", "boom marker here"),
      corpus_content("p3", "good three"),
    ]);
    const { embed } = counting_embed({ throw_if: "boom marker" });

    const report = await run_embed_pass(corpus, store, embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    expect(report.failed).toBe(1);
    expect(report.embedded).toBe(2);
    expect(await store.get("p1", MODEL_A)).not.toBeNull();
    expect(await store.get("p2", MODEL_A)).toBeNull(); // the failing page stored nothing
    expect(await store.get("p3", MODEL_A)).not.toBeNull();
  });

  it("yields to the event loop between pages (does not monopolise the loop)", async () => {
    const corpus = new FakeCorpus([corpus_content("p1", "one"), corpus_content("p2", "two")]);
    const events: string[] = [];
    const embed: EmbedFn = async (text) => {
      events.push(`embed:${text}`);
      // Schedule a macrotask during the first page; the inter-page yield must
      // let it run BEFORE the second page is embedded.
      if (text.includes("one")) setImmediate(() => events.push("loop"));
      return new Float32Array(DIM).fill(0.5);
    };

    await run_embed_pass(corpus, store, embed, MODEL_A, REPR, DEFAULT_PAGE_VECTOR_CONFIG);

    const loop_index = events.indexOf("loop");
    const second_embed_index = events.findIndex((e) => e.includes("two"));
    expect(loop_index).toBeGreaterThan(-1);
    expect(loop_index).toBeLessThan(second_embed_index);
  });

  it("never scans a never-cluster origin — the corpus drops it before fetch (AC #8)", async () => {
    const bank: CorpusContent = {
      ...corpus_content("bank1", "sensitive balance"),
      url: "https://mybank.com/account",
    };
    const ok: CorpusContent = {
      ...corpus_content("ok1", "public article"),
      url: "https://blog.example.com/post",
    };
    const corpus = new FakeCorpus([bank, ok]);
    const { embed, calls } = counting_embed();

    const report = await run_embed_pass(
      corpus,
      store,
      embed,
      MODEL_A,
      REPR,
      DEFAULT_PAGE_VECTOR_CONFIG,
      new Set(["mybank.com"]),
    );

    // The blocked page is dropped upstream — never scanned, never embedded,
    // never re-downloaded (the corpus filters before get_content).
    expect(report.scanned).toBe(1);
    expect(report.embedded).toBe(1);
    expect(calls.some((t) => t.includes("balance"))).toBe(false);
    expect(await store.get("bank1", MODEL_A)).toBeNull();
    expect(await store.get("ok1", MODEL_A)).not.toBeNull();
  });
});
