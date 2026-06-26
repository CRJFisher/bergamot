import * as tdt from "./index";
import { run_tdt, type TdtDeps, type TdtArgs } from "./index";
import {
  DEFAULT_HDBSCAN_CONFIG,
  DEFAULT_PAGE_VECTOR_CONFIG,
  DEFAULT_WINDOW_CONFIG,
} from "./config";
import {
  FakeRelationalReader,
  FakeVectorStore,
  FakeClusterSink,
  create_fake_embed,
} from "./fakes";

function make_deps(): { deps: TdtDeps; sink: FakeClusterSink; embedded_texts: string[] } {
  const { embed, embedded_texts } = create_fake_embed();
  const sink = new FakeClusterSink();
  const deps: TdtDeps = {
    reader: new FakeRelationalReader(),
    embed,
    vector_store: new FakeVectorStore(),
    sink,
  };
  return { deps, sink, embedded_texts };
}

const ARGS: TdtArgs = {
  window_start: "2024-01-01T00:00:00Z",
  window_end: "2024-02-01T00:00:00Z",
  embedding_model_id: "test-model@1",
};

describe("run_tdt (scaffold)", () => {
  it("resolves without error when wired to in-memory fakes", async () => {
    const { deps } = make_deps();
    await expect(run_tdt(deps, ARGS)).resolves.toBeUndefined();
  });

  it("is a no-op: writes nothing to the sink and embeds nothing", async () => {
    const { deps, sink, embedded_texts } = make_deps();
    await run_tdt(deps, ARGS);
    expect(sink.results).toHaveLength(0);
    expect(sink.runs.size).toBe(0);
    expect(embedded_texts).toHaveLength(0);
  });

  it("FakeVectorStore round-trips a vector by (page, model) key", async () => {
    const store = new FakeVectorStore();
    const vec = new Float32Array([1, 0, 0]);
    expect(await store.get("page-1", "test-model@1")).toBeNull();
    await store.put("page-1", "test-model@1", "title_plus_lead", vec);
    expect(await store.get("page-1", "test-model@1")).toEqual(vec);
    expect(await store.get("page-1", "other-model@2")).toBeNull();
  });
});

// The LLM cluster namer is a SEAM ONLY in this slice (plan §7, AC#4): a
// documented interface boundary, with no implementation and — deliberately — no
// default-off config flag. These guards fail loud if a dead flag or a runtime
// namer export creeps in before the LLM slice lands.
describe("LLM-naming seam is not shipped (AC#4)", () => {
  it("ships no LLM-naming flag on any swept config", () => {
    const keys = [
      ...Object.keys(DEFAULT_HDBSCAN_CONFIG),
      ...Object.keys(DEFAULT_PAGE_VECTOR_CONFIG),
      ...Object.keys(DEFAULT_WINDOW_CONFIG),
    ];
    expect(keys.filter((k) => /llm|naming|namer/i.test(k))).toEqual([]);
  });

  it("exposes no LLM-namer runtime export from the barrel", () => {
    const exports = Object.keys(tdt).filter((k) => /llm|namer/i.test(k));
    expect(exports).toEqual([]);
  });

  it.todo("documents the ClusterNamer seam + stable-core fingerprint (AC#4 — structural review check)");
});
