import { run_tdt, type TdtDeps, type TdtArgs } from "./index";
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
    expect(sink.written_runs).toHaveLength(0);
    expect(sink.written_clusters).toHaveLength(0);
    expect(sink.written_members).toHaveLength(0);
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
