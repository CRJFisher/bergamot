# TDT Embedding Model Selection (page-vector embedder)

Status: research-backed decision for TASK-36.3.1. Resolves the TDT-owned local
embedding model — open question §12 Q2 of `tdt-hdbscan-micro-tier-plan.md`.

This records the model TDT embeds re-downloaded public pages with, the library
it runs through, and the operating constraints (determinism, lifecycle,
licensing). It is the canonical reference the page-vector store and the batched
embed pass (run ahead of a TDT clustering run) are built against.

## Decision

TDT embeds page text with **`bge-small-en-v1.5`** (the ONNX build published as
`Xenova/bge-small-en-v1.5`), run **fully locally** through the
**`@huggingface/transformers`** `feature-extraction` pipeline with
`{ pooling: 'mean', normalize: false }` per call. The `EmbedFn` embeds one
segment per call and returns the RAW (un-normalized) vector — `build_page_vector`
pools the raw segment vectors and applies the single final L2-normalization
itself, so `normalize` is `false` at the embedder (the page layer owns L2).

| Property      | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| Model         | `bge-small-en-v1.5` (ONNX: `Xenova/bge-small-en-v1.5`)            |
| Dimension     | 384                                                               |
| Max sequence  | 512 tokens                                                        |
| Params / size | ~33.4M; ONNX q8 ~34 MB on disk                                    |
| Quantization  | `q8` (int8), selected via the pipeline `dtype` option             |
| License       | MIT                                                               |
| Library       | `@huggingface/transformers` **3.7.6** (pinned exact)              |
| Node backend  | `onnxruntime-node` **1.21.0** (ships the darwin-x64 binary)       |
| Prefixes      | **none** — symmetric clustering omits all instruction prefixes    |

**Version pin is load-bearing.** `@huggingface/transformers` 3.7.6 depends on
`onnxruntime-node` 1.21.0, which still ships the **darwin-x64** native binary the
Intel-Mac dev target needs; the 4.x line (onnxruntime-node 1.24.x) dropped
darwin-x64. Bumping the package requires re-running `npm run verify:embedder`
(checks 384-d output, byte-identical determinism, and the strict-offline guard)
and confirming the new onnxruntime-node still carries a darwin-x64 binary.

**`embedding_model_id` = `bge-small-en-v1.5/q8/384#repr-v1`** — model name +
quantization + dimension + page-representation-rule version. A change to any
component (model, quant, dim, repr rule) yields a new id, which is a clean
page-vector cache miss and (downstream) a new clustering run key.

**Fallback: `gte-small`** — also 384d, 512-token, ~33.4M params, MIT. Drop-in on
the same pipeline shape if bge underperforms on a labelled clustering window.

The 512-token ceiling matches the existing page-vector strategy: a long page is
split into ~512-token segments (proxied by the `segment_chars` code-point budget
in `PageVectorConfig`), each segment embedded, then mean-pooled in fixed float64
order. No instruction prefix is prepended to any segment.

## Determinism

The page-vector pipeline downstream (HDBSCAN over a precomputed cosine matrix)
is sensitive to the page vectors. The relevant question is narrower than
"is the embedder bitwise-deterministic across runs":

- A page vector is **built once by the batched embed pass and persisted** in
  `topic_page_vector`. Every downstream consumer (clustering, later RAG) only
  **reads** the stored vector. The clustering run is reproducible because it
  reads fixed stored bytes — not because it re-embeds.
- The pure-library pooling math (`build_page_vector`) is already
  bitwise-deterministic: NFC normalization, code-point segmentation, in-order
  embedding, fixed-order float64 accumulation, one float32 truncation.
- The only path that re-embeds is a cache miss (backfill, alternate
  model/repr, or a page re-embedded after its vector was forgotten). There,
  embedder run-to-run stability determines whether the rebuilt vector matches
  the original bytes.

**Mitigation (best-effort, verify empirically):** configure ONNX Runtime for
single-threaded sequential execution — `intra_op_num_threads = 1`,
`execution_mode = ORT_SEQUENTIAL` (the default), and where the OpenMP build
honours it, `OMP_NUM_THREADS=1`. Floating-point non-associativity in
multithreaded parallel reductions is the documented mechanism that breaks
run-to-run reproducibility; single-threaded CPU execution removes it.

The session options ARE settable through `@huggingface/transformers`: pass
`session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode:
"sequential" }` to `pipeline(...)`, which forwards them to the onnxruntime-node
`InferenceSession`. **Verified on the Intel x64 macOS / q8 stack**: with these
options the same text embeds **byte-identically** across runs and across a
reload (`scripts/verify-embedder.mjs`, run by `npm run verify:embedder`). The
property remains best-effort across other platforms — it is not a release gate,
because a page vector is built once and stored and clustering only reads the
stored bytes (re-embed on cache miss is the only path that depends on it).
Disabling graph optimizations is **not** required: the claim that extended-level
fusions change numerical output was refuted.

## Lifecycle (load-once, offline)

- **Offline:** set `env.allowRemoteModels = false` (equivalent to
  `local_files_only = true`). With the model file absent and remote models
  disabled, ONNX Runtime throws rather than reaching the network — the
  no-API-call guarantee.
- **Where the model lives:** `env.localModelPath` (default `/models/`) or the
  filesystem cache `env.cacheDir` (default `./.cache`); `env.allowLocalModels`
  defaults to `true` in Node. The model artifact is pre-downloaded / bundled to
  one of these paths under the extension's storage base.
- **Load once per pass:** construct the `feature-extraction` pipeline a single
  time at the start of an embed pass and reuse it across every page embedded in
  that pass; drop the reference when the pass finishes so the model is resident
  only while a pass runs, not for the lifetime of the extension.

## Caveats carried into implementation

- **Pin the package version.** `@huggingface/transformers` moves fast (v3 → v4
  in this window). Pin an explicit version and re-verify the `dtype` and `env`
  API against the installed version.
- **Determinism is unproven on this stack** — empirically verify before relying
  on bitwise identity (see above).
- **q8 accuracy figures are directional.** Published int8 accuracy deltas
  (<1.55% retrieval) come from static calibrated quantization on Xeon/AMX, not
  transformers.js dynamic-quantized ONNX on consumer x64; the companion 4.5×
  latency-speedup claim was refuted. Treat q8 as the size/speed default, and
  re-check quality on a labelled window if clustering underperforms.
- **No benchmarked clustering comparison.** The bge-vs-gte choice rests on
  spec parity (both 384d / 512-token / MIT), not an independently verified MTEB
  Clustering ranking; the task-36.7 validation sweep is where the model is
  scored on real windows.

## Open implementation questions

1. **Resolved.** `@huggingface/transformers` exposes the hook directly: a
   `session_options` object on `pipeline(...)` is forwarded to the
   onnxruntime-node `InferenceSession`. `{ intraOpNumThreads: 1, interOpNumThreads:
   1, executionMode: "sequential" }` pins single-threaded sequential execution
   without any process-env or custom backend init.
2. **Resolved (on x64).** Single-threaded q8 inference of
   `Xenova/bge-small-en-v1.5` produces bitwise-identical 384-d vectors across runs
   and across a reload on Intel x64 macOS (`npm run verify:embedder`). The
   property is treated as best-effort across other platforms (not a release gate).
3. **Open.** Per-page latency and resident memory of the loaded q8 pipeline on
   the target hardware, single-threaded — to be characterised by the task-36.7
   validation sweep; embed-pass throughput has been acceptable in manual runs.

## Sources

- BAAI/bge-small-en-v1.5 model card — dims, tokens, params, MIT, prefix FAQ.
- Xenova/bge-small-en-v1.5 — ONNX build, transformers.js usage example.
- thenlper/gte-small — fallback spec, MIT.
- transformers.js docs (index, dtypes, env, backends/onnx, custom_usage) —
  package name, `dtype`, `env.allowRemoteModels`/`cacheDir`/`localModelPath`,
  onnxruntime-node backend.
- ONNX Runtime docs (threading, graph-optimizations) + issue #3233 — thread
  pinning for determinism.
- arXiv 2408.05148 (SC'24, ORNL) — FP non-associativity and reproducibility.
