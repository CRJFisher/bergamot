import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { run_cluster_compute } from "./cluster_worker_client";
import type { ClusterComputeInput } from "@bergamot/tdt/out/cluster_pipeline";

// A tiny stub worker standing in for the real clustering worker, so the client's
// fork / IPC / advanced-serialization / timeout behaviour is tested WITHOUT
// loading TensorFlow (compute_clusters itself is covered in @bergamot/tdt). The
// stub echoes the input's first vector back as a representative vector, proving
// Float32Array survives the round trip.
const STUB_OK = `
process.on('message', (msg) => {
  const v = msg.input.vectors[0].vector; // a Float32Array under advanced serialization
  process.send({
    ok: true,
    output: {
      labels: msg.input.visits.map(() => 0),
      probabilities: msg.input.visits.map(() => 0.9),
      represented: [{
        local_label: 0,
        member_indices: msg.input.visits.map((_, i) => i),
        representative_index: 0,
        representative_vector: v,
        size: msg.input.visits.length,
        time_span: { start: 's', end: 'e' },
      }],
      cluster_labels: [],
      algo_version: 'stub#1',
    },
  });
});
`;

const STUB_FAIL = `
process.on('message', () => process.send({ ok: false, error: 'stub failure' }));
`;

const STUB_SILENT = `process.on('message', () => { /* never replies */ });`;

// The real-world TF-OOM / segfault case: the worker dies WITHOUT sending a result.
const STUB_CRASH = `process.on('message', () => process.exit(1));`;

let dir: string;
function write_stub(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function input(): ClusterComputeInput {
  return {
    visits: [
      {
        page_session_id: "p0",
        url: "https://x.com/0",
        title: "T",
        site_name: null,
        page_loaded_at: "2026-06-10T00:00:00.000Z",
        tree_id: "t1",
      },
    ],
    vectors: [
      { page_session_id: "p0", vector: Float32Array.from([0.5, -0.25, 1]), low_confidence: false },
    ],
    hdbscan: { min_cluster_size: 3, min_samples: 5, method: "eom", epsilon: 0 },
    max_samples: 4000,
  };
}

describe("run_cluster_compute", () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tdt-worker-"));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("forks the worker and returns its result, preserving Float32Array vectors", async () => {
    const worker_path = write_stub("ok.js", STUB_OK);

    const out = await run_cluster_compute(input(), { worker_path });

    expect(out.algo_version).toBe("stub#1");
    expect(out.labels).toEqual([0]);
    // The vector crossed the IPC boundary as a typed array, not JSON-mangled
    // (a plain-object {0:..,1:..} would have no buffer and Array.from would be
    // empty). `instanceof` is unreliable here — the value arrives in the IPC
    // deserialization realm — so assert the typed-array shape and the values.
    const vector = out.represented[0].representative_vector;
    expect(ArrayBuffer.isView(vector)).toBe(true);
    expect(vector.constructor.name).toBe("Float32Array");
    expect(Array.from(vector)).toEqual([0.5, -0.25, 1]);
  });

  it("rejects when the worker reports a failure", async () => {
    const worker_path = write_stub("fail.js", STUB_FAIL);
    await expect(run_cluster_compute(input(), { worker_path })).rejects.toThrow(
      /stub failure/,
    );
  });

  it("kills the worker and rejects on timeout", async () => {
    const worker_path = write_stub("silent.js", STUB_SILENT);
    await expect(
      run_cluster_compute(input(), { worker_path, timeout_ms: 200 }),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects when the worker cannot be spawned (bad path → child 'error')", async () => {
    const worker_path = path.join(dir, "does-not-exist.js");
    // No result, no hang, no leaked timer — the fork error settles the promise.
    await expect(
      run_cluster_compute(input(), { worker_path, timeout_ms: 5000 }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects when the worker exits without returning a result (crash → child 'exit')", async () => {
    const worker_path = write_stub("crash.js", STUB_CRASH);
    await expect(
      run_cluster_compute(input(), { worker_path, timeout_ms: 5000 }),
    ).rejects.toThrow(/exited before returning a result/);
  });
});
