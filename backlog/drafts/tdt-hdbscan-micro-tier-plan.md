# TDT Micro-Tier: Windowed HDBSCAN Project Detection — Architecture

Status: draft (backlog). Lead architect plan for the first, most-important TDT slice.

---

## 1. Overview & product goal

bergamot captures the user's web browsing as timestamped page visits. The **Temporal
Topic Detection & Tracking (TDT)** subsystem turns that raw stream into **coherent
"projects" / "research threads"** — groups of highly-related pages the user actually
worked on.

This first slice ships the **micro tier**: _windowed HDBSCAN clustering_. For each time
window it groups page visits by **embedding similarity** (doc↔doc cosine on page
vectors), producing clusters that read as candidate projects, and it **rejects one-off
pages as noise** rather than forcing them into a topic. A cluster = a set of PAGES = one
candidate research thread.

Two axes are kept strictly separate, exactly as the product vision requires:

- **Embedding axis** — the only thing HDBSCAN clusters on (cosine over page vectors).
- **Time axis** — used only for _windowing_ (and, later, _tracking_). Time is never
  fused into the embedding.

TDT stands fairly separate from the rest of bergamot. It is a modular, offline/batch
subsystem that reads the captured **metadata** from DuckDB (URL, title, timestamp,
session graph — task-35), obtains page content by **re-downloading the public URL during
post-processing**, **embeds that re-downloaded content itself**, writes its OWN cluster
tables, and exposes a new read-only MCP surface. TDT is the **first consumer of the
re-download corpus**; RAG (task-31) comes after — see §4. It adds no LLM to the ingest
path; capture stays zero-LLM and metadata-only (task-35).

The deliverable answers one question for the user: _"What projects have I been working
on, and which pages belong to each?"_

---

## 2. Scope (this slice) & explicit non-goals

### In scope (build now)

- Deterministic **per-window HDBSCAN** clustering of **page-level** vectors.
- A **page vector** TDT computes itself by embedding each **re-downloaded public page**
  (independent of the RAG pipeline).
- **Calendar-month windows** with a hard sample-count guard and deterministic
  subdivision when a window is too large for HDBSCAN.
- **Cosine via `metric='precomputed'`** (a dense `(n,n)` cosine-distance matrix).
- **Noise (`-1`)** surfaced as a first-class signal ("pages in no project").
- **Membership probabilities** used to rank core-vs-fringe pages in a project.
- A **deterministic labeler** (exemplar headline + domain scope + cheap keyphrases).
- Persistence to **new DuckDB tables**, keyed by a reproducible run identity.
- Three **read-only MCP tools** + the HTTP `/query/*` routes that back them.
- A **deterministic validation harness** (the parameter sweep is part of this slice
  because parameter choice is the load-bearing risk).

### Non-goals — described here only as clean seams, not implemented

- **Cross-window tracking / lifelines** (emerge/persist/merge/split/die). This is
  clustering-tfjs Phase 4 (`trackClusters`). The seam is: each cluster persists a frozen
  **representative vector** and run windows are pure functions of `(date, config)`, so a
  later tracker simply walks adjacent windows and Hungarian-matches representatives.
  No tracking logic ships; no lifeline IDs are written.
- **SOM macro tier** (enduring interests over the whole stream). Seam: the page vector
  and metric are the _one shared cosine space_ the macro tier will reuse.
- **LLM cluster naming / micro→macro linkage adjudication.** Seam: the deterministic
  label fields ARE the future LLM prompt bundle; a gated, cached LLM rewrite lands later.
- **Incremental / append clustering.** HDBSCAN is fit-only (no `predict`). v1 recomputes
  a window from scratch. The seam is window-level memoization (closed windows are
  immutable, so they are computed once and reused).
- **UMAP** and any non-deterministic reducer. Left external by the library on purpose.
- **Tree-relatedness priors blended into the distance matrix.** `tree_id` is metadata in
  v1 only.

---

## 3. Architecture

### Module boundary

TDT is a **new top-level npm workspace package `tdt/`** (sibling of `vscode/` and
`browser/`), internal name `@bergamot/tdt`. It is a **pure, dependency-injected library**
plus thin adapters. It NEVER imports `vscode/src` internals; it depends only on its
injected port contracts and on `clustering-tfjs`.

The root `package.json` `workspaces` array today is `["vscode", "browser"]`; this slice
adds `"tdt"`.

```text
tdt/
  package.json            # deps: clustering-tfjs, @xenova/transformers (local embeddings); dev: @duckdb/node-api, jest
  tsconfig.json           # extends ../tsconfig.base.json
  src/
    index.ts              # public API: run_tdt(deps, args)
    ports.ts              # injected contracts: RelationalReader, EmbedFn, VectorStore, ClusterSink
    config.ts             # DEFAULT_WINDOW_CONFIG, DEFAULT_HDBSCAN_CONFIG
    windowing.ts          # page_loaded_at -> windows + count-guarded subdivision
    page_vectors.ts       # re-downloaded page -> page-level text -> EmbedFn -> one page vector (cached)
    cluster_window.ts     # precomputed cosine-distance matrix -> HDBSCAN.fit (the ONLY library call)
    representations.ts    # exemplar/medoid representative + frozen representative vector
    labeling/
      deterministic_labeler.ts   # headline + scope + keyphrases (no LLM)
    persist.ts            # write run/cluster/member rows via ClusterSink
    validation.ts         # silhouette/DBCV-style gates + parameter sweep harness
    cli/run_batch.ts      # headless entrypoint
```

### Dependency direction (acyclic)

```text
@bergamot/tdt  ──depends on──►  clustering-tfjs   (HDBSCAN, pairwise cosine distance, metrics)
@bergamot/tdt  ──depends on──►  ports.ts contracts (RelationalReader/EmbedFn/VectorStore/ClusterSink)

vscode/ (the extension)  ──supplies──►  the concrete port implementations + triggers run_tdt
vscode/ ──NEVER── imported by tdt/
```

### The DuckDB single-writer constraint (load-bearing, drives everything)

DuckDB is **single-writer per file across processes**: while the VS Code extension holds
the database read-write (it does, for its whole lifetime), **no other process can open
the file — even read-only**. The extension is the _only_ writer. Every other consumer
today (the standalone MCP server) reads relational data over the extension's HTTP
`/query/*` broker, never by opening the file. The `read_only` branch in `duck_db.ts`
exists but is dormant; it is **not** the working concurrency model.

TDT honors this with an **asymmetric data-access** design:

- **Relational reads (DuckDB)** go through a `RelationalReader` port. Its production
  implementation reads through the extension (in-process reader fns when TDT runs inside
  the extension command; HTTP `/query/*` when TDT runs as the batch CLI). TDT never opens
  the capture DuckDB file directly. Getting this wrong is an **availability** failure
  (the file open is refused), not corruption — but it still breaks the batch job.
- **Page vectors use TDT's own representation + model** (built at ingestion from the extracted
  public content the task-39.2 re-download caches; §4), stored in a TDT-owned `topic_page_vector`
  table in the **same DuckDB file**.
  There is no second vector store and no LanceDB dependency: LanceDB was evaluated and rejected
  because it cannot be encrypted at rest while remaining searchable, and content-derived vectors
  are sensitive. The encrypted DuckDB store serves both the K-V vector cache (get/put) and
  downstream similarity search via built-in `array_cosine_similarity` over fixed-size
  `FLOAT[dim]` columns, and is shared with RAG (task-31) as one store / one embedding space. The
  cache is read and written on the same DuckDB path as everything else (through the extension's
  writer), not via a separate handle.
- **Cluster writes** go through a `ClusterSink` port. The write path is owned by the
  extension's single writer — TDT's compute hands results back, and the extension persists
  them in one short transaction. The batch CLI does read+compute only; it does not write.

### Where the cluster tables live

TDT cluster tables live in the **same DuckDB file** as the capture tables, written **only
by the extension's writer**. This buys the load-bearing benefit — windowed selection
(`webpage_activity_sessions` × `webpage_capture` on the indexed `page_loaded_at`) and the
MCP read path are plain single-DuckDB JOINs, consistent with the existing five tools. The
TDT schema is created by the extension's writer (a TDT schema step invoked from the
extension), not by a separate process. The alternative — a separate `topics.db` owned by a
standalone writer and `ATTACH`ed read-only — is the correct pattern _only if_ a headless
TDT writer process is ever wanted (a LATER concern, YAGNI); it is explicitly deferred.

### Data flow

```text
                  ┌─────────────────────── @bergamot/tdt (pure, DI) ───────────────────────┐
DuckDB (capture)  │                                                                        │
  webpage_*       │  RelationalReader.list_visits_in_window(start,end)                      │
   tables  ──────────►  fetch_visits  ──(stable ORDER BY page_loaded_at, page_session_id)─► │
        ▲          │        │                                                               │
        │ (writer  │        ▼                                                               │
        │  owns    │  resolve_page_vector: read topic_page_vector (built at ingestion)     │
        │  file)   │  ──────────────────────────► one L2-normalized vec / page               │
        │          │        │  (vectors built at ingestion; miss → backfill; no RAG dep)    │
        │          │        ▼                                                               │
        │          │  build (n,n) cosine DISTANCE matrix  D = clamp(1 - dot, 0, 2)          │
        │          │        │  metric='precomputed';  n = PAGES, guarded <= ~4000           │
        │          │        ▼                                                               │
        │          │  HDBSCAN.fit(D)  ──► labels_(-1=noise), probabilities_, exemplarIndices_│
        │          │        ▼                                                               │
        │          │  representations (exemplar/medoid + frozen representative vector)      │
        │          │        ▼                                                               │
        │          │  deterministic_labeler (headline + scope + keyphrases)                 │
        │          │        ▼                                                               │
        │          │  ClusterSink.write(run, clusters, members)  ──────────────────────────┘
        │          │
        └──────────── extension writer persists topic_run / topic_cluster / topic_cluster_member
                                 │
                                 ▼
                   HTTP /query/topic_* ──► MCP tools (list_topic_clusters, get_topic_cluster,
                                                       list_clusters_for_page)
```

---

## 4. Data inputs & the page-vector problem

### The page-vector problem (TDT owns vectorisation)

bergamot's capture pipeline (task-35) stores browsing **metadata only** (URL, title,
timestamp, session graph) — **no page content and no embeddings**. Content is obtained later
by **task-39.2 re-downloading the public URL during post-processing** (eagerly per visit, into
the encrypted content cache). TDT **owns the page representation + embedding model** (the
`build_page_vector` definition), but the embedding itself **runs at ingestion**, in the same
eager-re-download pass that warms the content cache (see "Where vectorisation runs" below) —
TDT never re-downloads, parses HTML, or classifies fetch outcomes itself; it reads the
already-extracted content (a `PageContent` projection of `CorpusContent`) and the page vector it
produced at capture time.

**TDT is independent of the RAG pipeline (task-31), and is the first consumer of the
re-download corpus.** Both RAG and TDT operate over the same re-downloaded public content, but
RAG chunks pages for _retrieval_ while TDT embeds whole pages for _clustering_. The only
nominal overlap is "both embed text," and even that differs (chunk vs page granularity,
potentially different models). TDT needs none of RAG's chunking, contextual-retrieval prefixes,
hybrid/BM25 indexing, or reranking — and never waits on it.

**Output contract (fixed):** the clustering unit is the **page visit**. `n` = page count,
which keeps windows under the `~5k` ceiling and makes a cluster mean "a set of pages."

**Page representation + embedding (TDT-owned, swappable seam):** isolate page-vector
construction behind one pure function so the representation strategy is A/B-comparable
without reshaping the pipeline:

```ts
// page_vectors.ts
export type PageRepr = "title_plus_lead" | "main_content_extract";

/**
 * Build one L2-normalized page vector by embedding a deterministic page-level text.
 * For pages over the embedder's token budget, split → embed segments → mean-pool
 * (a throwaway internal split; NOT RAG chunking — no contextual prefixes, no persistence).
 */
export async function build_page_vector(
  page: PageContent, // already-extracted main-content + title (projection of CorpusContent, task-39.2)
  embed: EmbedFn, // TDT's own local embedding model (injected)
  repr: PageRepr,
  config: PageVectorConfig,
): Promise<PageVector | null>; // null = excluded (no extractable text / truly degenerate)
```

- **Default representation = title + lead/main-content extract** of the re-downloaded page,
  truncated to the embedder's
  token budget, embedded by TDT's own model, then **L2-normalized** (mandatory: it makes the
  page→page `1 - dot` a valid cosine distance and is the boundary contract for a later
  Euclidean consumer like the SOM tier; it is a no-op for the cosine matrix itself, which is
  magnitude-invariant). Deterministic and cheap at cluster time; zero-LLM.
- **Long-page handling (built now):** a page over the token budget is split into segments,
  each embedded, and mean-pooled. This internal split is throwaway and unrelated to RAG
  chunking.
- **Guardrail for multi-topic pages (correctness, not a feature):** flag pages whose segments
  have high dispersion (low mean pairwise cosine); represent those by their **dominant
  segment** rather than a mean that lands in dead space between sub-topics.
- **Degenerate guard (built now):** if the pooled vector norm `< ε`, fall back to the
  dominant segment rather than dividing by ≈0 to produce an arbitrary direction.
- **No-text / failed-re-download exclusion (built now):** a page that fails to re-download
  (login redirect, 403, paywall, dead link) or yields no extractable text (binary, empty body)
  has **no embedding**. The login wall is the privacy filter — auth-walled pages fall out here
  automatically, with no ingestion-time content heuristic. Exclude all such pages from
  clustering; never feed a zero vector into `D`. The clusterable corpus is therefore the
  **re-downloadable public subset**; auth-walled/failed visits remain trail/metadata only.
- **Cache:** store each page vector in a TDT-owned `topic_page_vector(page_session_id,
embedding_model_id, vector)` table so re-runs reuse it and a model change invalidates it.

**Why one vector per page (the altitude choice).** Clustering operates at _project_ altitude
(page-sets), not paragraph altitude, and the `~5k` dense-matrix ceiling makes the page the
right unit (`n` = page count). A whole-page embedding is coarse by design — a single vector
for a multi-topic page can blur, which is exactly why the dispersion guard above exists.
("Page vs navigation-tree" is the next granularity question, not assumed final here.)

**Determinism.** A page vector is a pure function of (re-downloaded bytes, page-representation
rule, embedding model). TDT **persists its embedding model identity + representation-rule
version on the run**; changing either triggers a full re-cluster. "Deterministic" means
_given a fixed re-downloaded snapshot and a pinned model_ — which TDT fully controls, since it
owns its embedder. There is no external contextualizer coupling.

**Re-download fidelity caveat.** Unlike a captured snapshot, the re-downloaded bytes are not
guaranteed to equal the page as viewed: dynamic/JS-rendered content, dead links,
paywall/consent drift, A/B variants, and edits over time all diverge, and a page may
re-download successfully on one run and fail on the next. Page vectors are therefore stable
only relative to a given re-download; the run records the fetch fidelity metadata
(`fetched_at`, `http_status`, content hash) so drift and changes in corpus membership are
visible across re-clusters.

### Where vectorisation runs (ingestion-time) & cold start

**The page vector is produced at ingestion, not on TDT's schedule.** The eager re-download
(task-39.2) already fetches and extracts a page's public content the moment it is captured (the
`on_captured` hook in the visit-queue processor); embedding is the next step in that same pass,
so the canonical page vector is built once at capture time and written to `topic_page_vector`.
TDT (and RAG) only **read** vectors — `build_page_vector` is owned by TDT as the definition of
the page representation + model, but it **runs in the ingestion pipeline**, off the capture hot
path. `resolve_page_vector`'s build-on-miss is then the backfill / alternate-model-or-repr path
(a new `embedding_model_id` is a clean miss → rebuild), not the common case.

Cold start is therefore a non-issue: vectors accumulate as the user browses, so when TDT runs a
window the vectors it needs are already present. TDT never waits on the RAG pipeline. (The
concrete `topic_page_vector` store, the `on_captured` embedding wiring, and the right-to-forget
cascade entry are TASK-36.3.1.)

**The one deferred seam (an option, not a dependency).** If cross-feature work is ever wanted
— grouping RAG search hits by project cluster, or the later macro→micro LLM linkage reasoning
over both systems — TDT and RAG must embed in the _same_ space. v1 picks its own local model
(Intel x64, offline, deterministic); aligning the two models later is a config change, not a
re-architecture. Recorded as an open question (§12), **not** a build dependency. The internal
invariant that does bind v1 is narrower: TDT's own micro and macro tiers share _one_ embedding
space — the one TDT produces.

---

## 5. Windowing strategy

**Unit: the page visit.** Window math is over `webpage_activity_sessions.page_loaded_at`,
which is canonical and **indexed**. It is stored as **TEXT (ISO-8601)**, so all window
math must `CAST(... AS TIMESTAMP)`.

**Default window: calendar month (UTC).** A research thread spans many sessions over
days-to-weeks; the window must be coarse enough for those scattered visits to co-occur and
reach `minClusterSize`. Day/week windows shatter a multi-week project, and there is no
cross-window tracking in this slice to stitch fragments back. Month is the coarsest
calendar unit that, at personal browsing volume, generally stays under the ceiling.
**Window length is a swept config parameter (`{14d, month}`)**, not a hardcoded magic
number — see §6/§11. `tree_id` is carried as metadata/provenance only; navigation trees
are **never** a window boundary (a project deliberately spans many trees).

**Why calendar, not gap-sessionization, for the PRIMARY boundary.** The honest reason is
_idempotence and a fixed cadence_, not "comparability": calendar boundaries are a pure
function of timestamps, so re-runs are byte-stable and the future stateless `trackClusters`
has a fixed timeline of frames to thread. (A fixed-threshold gap split is _also_
deterministic, so reproducibility alone does not decide it; what gap-splitting loses is the
fixed calendar cadence.) DuckDB's "session windows" are a SQL gap recipe, not a native
primitive, and `webpage_trees` already exists as a behavioral grouping — both are
data-dependent boundaries deferred for v1.

**Hard count guard (the real invariant).** The `~5k` ceiling is on **samples passed to
HDBSCAN** = page count after pooling, not on calendar length. Before each `fit`, assert
`n_pages <= MAX_SAMPLES` (default **4000**, headroom under `~5k` for the dense `(n,n)`
matrix + MST/condensed-tree scratch). A calendar boundary does **not** by itself bound a
count — the guard does.

**Subdivision when a window overflows the guard.** Subdivide deterministically, preferring
seams that preserve project coherence:

1. Split the window at its **largest inter-visit gaps** (fixed, documented gap threshold —
   still a pure function of the timestamps, so fully reproducible). Gap seams respect the
   natural boundaries of behavior, the thing the module exists to find.
2. Only if a gap-split sub-window is still over the guard (a genuine dense burst), fall
   back to deterministic **calendar bisection** (half-month → ISO week).

Record the **actual window bounds used** per run so the future stateless tracker can thread
frames regardless of irregular lengths (it matches on representative vectors, not on equal
calendar spans).

**Per-window N variance vs HDBSCAN's N-sensitivity.** A fixed calendar span yields wildly
varying N with bursty browsing. v1 controls this by (a) clustering page-level vectors (the
chunk multiplier is removed at source), and (b) the count guard + subdivision above; if the
sweep (§11) shows fixed-span windows produce unstable clusters, `minClusterSize` can move to
a small fraction of N or the cadence to a target-N band — fixed-span windowing is treated as
a seam, not a baked-in assumption.

**Empirical prerequisite.** Before fixing the default, query the live DuckDB
`page_loaded_at` distribution. If a typical month routinely exceeds a few thousand pages,
tighten the default to 14 days or promote PCA (§6).

```sql
-- Resolve the scale question against real data before committing a window default.
SELECT date_trunc('month', CAST(page_loaded_at AS TIMESTAMP)) AS wk,
       count(*) AS visits
FROM webpage_activity_sessions
GROUP BY 1 ORDER BY 2 DESC LIMIT 24;
```

**Sparse / cold windows.** A window with `< min_window_visits` (default 8) embeddable pages
cannot produce a meaningful cluster; skip it and surface "not enough data yet" rather than
spurious singletons.

```ts
export interface WindowConfig {
  unit: "month" | "days";
  days?: number; // when unit==='days'
  tz: "UTC";
  max_samples: number; // 4000: hard count guard, headroom under ~5k
  subdivide_order: ("gap" | "half_month" | "iso_week")[];
  min_window_visits: number; // 8
}
export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  unit: "month",
  tz: "UTC",
  max_samples: 4000,
  subdivide_order: ["gap", "half_month", "iso_week"],
  min_window_visits: 8,
};
```

---

## 6. The clustering pipeline

A sequence of pure-ish, individually testable stages with **all `clustering-tfjs` calls
isolated in one stage**. v1 is full-recompute per window (no append path).

### Stages and types

```ts
// types.ts
export interface VisitRow {
  // Stage 1
  page_session_id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  page_loaded_at: string; // ISO TEXT
  tree_id: string;
}
export interface PageVector {
  // Stage 2 (order preserved from Stage 1)
  page_session_id: string;
  vector: Float32Array; // L2-normalized page vector
  low_confidence: boolean; // multi-topic dispersion / fell back to dominant segment
}
export type DistanceMatrix = number[][]; // Stage 4: dense (n,n), D[i][i]=0, symmetric, [0,2]

export interface HdbscanRaw {
  // Stage 5
  labels: number[]; // -1 = noise
  probabilities: number[]; // [0,1], 0 for noise
  exemplar_indices: Map<number, number>; // clusterId -> single row index (eom + storeExemplars)
}
export interface RepresentedCluster {
  // Stage 7
  local_label: number;
  member_indices: number[];
  representative_index: number; // exemplar (eom) else medoid
  representative_vector: Float32Array; // FROZEN: L2-normalized mean of member vectors
  size: number;
  time_span: { start: string; end: string };
}
```

**Stage 1 — `fetch_visits(window)`** (DuckDB via `RelationalReader`). One row per page
visit with a capture, **`ORDER BY page_loaded_at, page_session_id`** — this stable total
order is the determinism anchor for HDBSCAN's MST/Prim tie-breaking and label numbering.
`page_loaded_at` is non-unique; `page_session_id` (a PK) makes the order total. Dedupe
near-identical repeat visits to the same URL within a tree (a cheap, deterministic Chrome
`SimilarVisitDeduper` analog) before pooling, so reloads/redirects don't inflate density.

**Stage 2 — `resolve_page_vectors(visits)`** (TDT-owned embedding + cache). The only stage
that touches vectors. For each page, return the cached `topic_page_vector` if present for the
current `embedding_model_id`; otherwise re-download the public URL, build the page text from
the fetched content, embed via `EmbedFn`, L2-normalize, and cache it (§4). When a long page is
split into segments, accumulate the segment mean in **fixed (segment) order with a float64
accumulator** — float32 addition is non-associative, and unstable order would produce
bitwise-different page vectors and flip MST ties. Drop pages that fail to re-download (the
login wall excludes auth-walled pages here) and no-text pages.

**Stage 3 — `reduce_dimensions` (OFF in v1, typed identity pass-through).** No reducer in
v1. The constitution rules out **UMAP** (non-deterministic SGD/numba, left external by the
library). It does **not** rule out **PCA**, which is deterministic. The honest v1 stance is
_"no dimensionality reduction in v1, with deterministic PCA-to-~50d as the first lever if
guardrails trip,"_ not _"reduction is against our values."_ If ever enabled it runs BEFORE
the distance matrix and the same reduced space feeds representations (one-shared-space
invariant).

**Stage 4 — `build_cosine_distance_matrix(pageVectors)`**. Use the library's existing
`pairwise_distance_matrix(X, 'cosine')` (verified present at
`clustering-js/src/distance/pairwise_distance.ts`, returns `1 − cosine_similarity`); no new
distance code. Then **clamp** `D = max(0, 1 - dot)` (float error can push dot slightly
outside `[-1,1]`, and HDBSCAN's mutual-reachability assumes non-negative distances), force
the diagonal to exactly 0, and symmetrize. This is the **hard ceiling** stage: dense
`O(n²)`. Oversized windows are a hard error here (the §5 guard prevents reaching it).

**Stage 5 — `run_hdbscan(D, params)`** (the ONLY `clustering-tfjs` call):

```ts
import { HDBSCAN } from "clustering-tfjs";
const model = new HDBSCAN({
  metric: "precomputed", // cosine is NOT native; precomputed D is the only path
  minClusterSize: params.min_cluster_size, // default 3 (pages)
  minSamples: params.min_samples, // default 5, DECOUPLED from minClusterSize
  clusterSelectionMethod: params.method, // default 'eom'
  clusterSelectionEpsilon: params.epsilon, // default 0.0
  storeExemplars: true, // required for exemplarIndices_
});
await model.fit(D); // fit-only, deterministic, no seed
```

### Parameters (decoupled, validated, configured — not magic constants)

The adversarial review marked the original `minSamples=1–2 / leaf` choice **flawed**. The
revision is adopted:

- **`minClusterSize = 3` (pages).** A 3-page thread is a real personal-scale project.
  BERTopic's corpus-scale 15 would collapse a personal window to all-noise. **Counts
  pages**, which is only meaningful because the unit is the page (§4).
- **`minSamples = 5`, explicitly DECOUPLED from `minClusterSize`.** The library default
  equates them; a low `minSamples` _under-smooths_ the MST in high-dim cosine space,
  causing chaining, fragile clusters, and label flips that violate reproducibility — and it
  _weakens_ the noise rejection the design depends on. A moderate `minSamples` preserves
  honest `-1`. Swept over `{3, 5, 8}`.
- **`clusterSelectionMethod = 'eom'`.** EOM gives the most stable clusters AND is the
  selection method under which the library defines exemplars (needed for representatives).
  `'leaf'` is exposed for finer splits but is not the default — it has no defined exemplars,
  so a representative would fall back to the medoid.
- **`clusterSelectionEpsilon = 0.0` default, swept `{0.0, 0.10, 0.20}` (cosine-distance
  units).** A small epsilon merges projects split by trivial cosine gaps and prevents dense
  weeks shattering into micro-clusters. Raise only if validation shows over-splitting.

Defaults are **starting points selected by the validation sweep (§11), persisted as config,
parameterized by window size** — re-tuning as history grows is a data change, not a code
change.

### High-dimensional geometry: a measured decision, not an assertion

Density-based clustering can flatten in high dimensions (distance concentration, hubness). The
v1 choice — **raw embedding space, no reducer** — is adopted because cosine removes the
magnitude axis the orthodoxy reacts to, modern sentence-embedding models are trained for cosine
separability, personal scale is small `n`, and aggressive noise rejection is the _desired_
behavior. (A smaller local model — e.g. a 384-d sentence encoder — both eases the curse of
dimensionality and is x64-friendly; the model is an open question, §12.) But this is committed
**with a gate, not on faith**:

- **A/B the baseline.** On a real multi-month slice, compare the raw embedding dim vs
  deterministic **PCA-to-~50d** (NOT ~5d — GDELT shows low-dim PCA collapses HDBSCAN to noise)
  and (if TDT's model supports it) a matryoshka-trimmed dim, scored by silhouette/DBCV-style
  validity and noise rate. Adopt raw only if it wins or ties. Confirm a _known_ project recovers
  as a cluster rather than dissolving into `-1`.
- **Noise-rate / hubness guardrail (not just a size guard).** Log per-window noise fraction
  and cluster count. Trip condition: noise fraction persistently `> ~0.6–0.7` across windows,
  or median cluster size collapsing toward `minClusterSize`, **promotes deterministic
  PCA-to-50d (or per-window centering) before HDBSCAN.** This catches the silent over-noising
  that "we want aggressive noise" would otherwise mask.

**A matryoshka-trimmed source dim is a storage/compute lever, not a clusterability lever** —
it cuts vector volume but gives **zero** relief on the `~5k` ceiling (the `(n,n)` matrix is the
same size at any `d`). If reduction for clusterability is ever needed, the lever is
deterministic **PCA**, not a smaller source embedding.

### The ~5k ceiling — handled, in order

1. **Narrow the window** (the §5 guard; default already 14d/month-with-subdivide).
2. **Gap-split, then calendar-bisect** an over-guard window (§5).
3. **PCA-to-50d** is a _capacity_ escape valve only as a last resort, and only if
   benchmarked not to collapse to noise. UMAP is never used.

### Noise & probabilities — first-class product signals

- **`labels_ == -1`**: "pages in no project." Exactly the one-off-rejection the product
  wants. Per-window noise fraction is a health metric (and the guardrail trigger above).
- **`probabilities_`**: rank pages _within_ a project. High = the core (show first, seed the
  representative). Low = fringe (fold under "loosely related"; good for user confirm/reject).
- **`exemplarIndices_`**: the single densest-core page per cluster → the project's headline.

**Structural noise re-attachment is DEFERRED (YAGNI).** v1 ships honest `-1`. Re-attaching a
noise page to a cluster because it shares a `tree_id` would let structure override the
embedding-density verdict, and trees routinely span multiple topics while referrers are often
null — so the prior is noisy and sparse exactly where it would do most damage, and it would
poison the cluster representatives that feed later tracking. Measure whether noise is actually
over-aggressive first; if re-attachment is ever added, gate it so structure may _propose_ but
embedding must _confirm_ (cosine distance to the cluster representative below a threshold).

### Determinism contract (three anchors, not one)

The review showed a stable `ORDER BY` is necessary but **not sufficient**:

1. **Stable fetch order** — `ORDER BY page_loaded_at, page_session_id` (MST tie-breaking).
2. **Stable segment→page reduction** — fixed-order float64 accumulation when mean-pooling a
   long page's segment embeddings (closes the float32 non-associativity gap row-order does
   not reach).
3. **Pinned tf backend + a bitwise reproducibility regression test** — run the same window
   twice, assert identical `labels_` AND `probabilities_` (mirrors the library's existing
   `affinity_knn_determinism.test.ts`). tf reductions can be non-deterministic independent of
   row order; verify, don't assume.

Scope the seed statement precisely: **the HDBSCAN micro-tier path uses no RNG** (fit-only,
deterministic parameter selection). This is _not_ a global "no seed anywhere" invariant —
any KMeans/medoid helper used for representatives takes an explicit `randomState`, and the
later SOM macro tier will require a seed.

### Full recompute, scoped to the window

HDBSCAN is fit-only; appending points correctly is impossible, so building an append path is
speculative surplus (YAGNI). "Full recompute" means **per window**, not per corpus. A
**closed** window's inputs are immutable (`page_loaded_at` is fixed once all its visits are
captured), so it is computed once and its results reused — only trailing/open window(s) and
windows whose `input_fingerprint` changed are re-fit. This is deterministic memoization
(via the run identity in §8), **not** incremental HDBSCAN, and it avoids the `O(history)`
waste that would contradict the cheap/deterministic ethos.

---

## 7. Cluster representation & labeling

### Representative (built now)

Per cluster pick a **representative page** = the `eom` exemplar (`exemplarIndices_`), which
is a single, deterministic, densest-core point. When `storeExemplars` is off or the method
is `leaf`, fall back to `select_medoids(X, labels, ...)` (library Phase 3). Note exemplar =
_densest-core_ point, NOT centroid-nearest — accepted for v1, flagged as a labeling-quality
caveat. Resolve exemplar → `page_session_id` (the exemplar indexes into the page-vector
matrix, which is page-granular by construction in §4, so no chunk→page hop is needed here).
If a richer "top 3–5 representative pages" view is wanted later, rank members by
`probabilities_` descending or use `select_medoids` — `exemplarIndices_` yields only the
single canonical representative.

Also compute the **frozen representative vector** = L2-normalized mean of member vectors.
v1 consumes it directly (labeling, ranking, minimal cross-run identity continuity, since
full-recompute label integers are run-local and non-stable). It is **also** the input the
Phase-4 tracker's Hungarian match needs — banked now, cheap, de-risks tracking.

### Deterministic labeler (built now, no LLM)

A label is stored as **separate fields**, never a single baked string, so the UI can
recompose and the later LLM can consume the bundle. Computed at **page granularity** (the
member set is already pages):

```ts
export interface ClusterLabel {
  headline_title: string; // exemplar page's webpage_capture.title
  scope: string; // dominant registrable DOMAIN(s)
  keyphrases: string[]; // cheap, deterministic terms (see below)
  display_label: string; // composed template, e.g. "Server components — Next.js docs +3 sites"
  representation_version: string; // bump when the labeler logic changes
}
```

- **`headline_title`**: the exemplar page's `title`. Recognizable anchor, free.
- **`scope`**: top-k `(domain, page_count)` from the registrable **domain** parsed from
  `url` as primary signal (always present); `site_name` is `<head>` metadata, often
  NULL/junk, so it is display enrichment only.
- **`keyphrases`**: **deterministic and cheap from already-available `<head>` metadata**
  (titles + site/author), NOT a window-relative c-TF-IDF pass in v1. The review showed
  c-TF-IDF is the one leg that is corpus-relative (the _same_ enduring project gets
  _different_ keyphrases as its window neighbors change — directly hostile to the cross-window
  label stability the tracking slice will need), requires re-download + HTML-strip +
  tokenize every run, and needs word-level embeddings the pipeline does not produce. It is
  **deferred** as the LLM namer's job. The v1 keyphrases field is populated from titles;
  a typed `keyphrases` field + `representation_version` are the seam for a later, page-level,
  fixed-corpus c-TF-IDF if measurement shows it is needed.
- **`display_label`**: a deterministic template over the parts.

### LLM naming — SEAM ONLY (design it, don't build it)

When built later it is a pure **rewrite** step (evidence bundle → one clean phrase), gated
by a config flag introduced **with** the code (no dead default-off flag now), and cached.
The cache is keyed on a **geometric + stable-core** signature, NOT on exemplar-id hashes
(the review marked the id-hash key flawed: a single exemplar flips on tiny changes →
over-fires; hub pages collide → under-fires):

- Re-fire only when the cluster's **representative vector** moves beyond a cosine threshold,
  OR the **stable core** (members with `probabilities_` above a cutoff, excluding noise/
  fringe) changes by Jaccard overlap `< ~0.8`. This reuses the same representative-vector +
  cosine machinery Phase-4 tracking uses — no parallel mechanism.

The cache table is **not created now** (it would require schema for a stable cluster identity
that does not yet exist — HDBSCAN is fit-only and labels are run-local). The seam is the
`Labeler` interface boundary + the stable-core fingerprint. Build the cache when both the LLM
path and the cluster-identity (tracking) model land. Displayed _lifeline_ labels (later) are
derived at the tracked-lifeline level so Phase-4 does not inherit per-window label churn.

---

## 8. Persistence

New tables in the existing DuckDB file, written **only** by the extension's writer. TEXT
PKs (identity hashes), ISO-8601 TEXT timestamps, `$param` placeholders — matching repo
convention.

```sql
-- A clustering RUN over one window: the unit of reproducibility and the cache key.
CREATE TABLE IF NOT EXISTS topic_run (
  id                 TEXT PRIMARY KEY,   -- sha256 of the normalized natural key below
  window_start       TEXT NOT NULL,      -- ISO, inclusive
  window_end         TEXT NOT NULL,      -- ISO, exclusive (ACTUAL bounds used, incl. subdivision)
  params_hash        TEXT NOT NULL,      -- resolved: HDBSCAN + pooling strategy + windowing policy + matryoshka dim
  params_json        TEXT NOT NULL,      -- resolved params, forensics
  embedding_model_id TEXT NOT NULL,      -- TDT's own model + dim + page-representation rule, e.g. 'bge-small-en@384#repr-v1'
  algo_version       TEXT NOT NULL,      -- 'hdbscan-1#<tf-backend>' (bumps on BACKEND change, not just code)
  input_count        INTEGER NOT NULL,   -- pages fed to HDBSCAN
  input_fingerprint  TEXT NOT NULL,      -- hash of sorted (page_session_id, embedding_vector_version) — data-drift
  cluster_count      INTEGER,
  noise_count        INTEGER,
  status             TEXT NOT NULL,      -- 'running' | 'complete' | 'failed' | 'superseded'
  created_at         TEXT NOT NULL,
  completed_at       TEXT,
  UNIQUE (window_start, window_end, params_hash, embedding_model_id, algo_version)
);
CREATE INDEX IF NOT EXISTS idx_topic_run_window ON topic_run(window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_topic_run_status ON topic_run(status);

-- One row per CLUSTER (HDBSCAN label >= 0). Noise (-1) is NOT a cluster row.
CREATE TABLE IF NOT EXISTS topic_cluster (
  id                       TEXT PRIMARY KEY,   -- hash(run_id | local_label)
  run_id                   TEXT NOT NULL REFERENCES topic_run(id) ON DELETE CASCADE,
  local_label              INTEGER NOT NULL,   -- HDBSCAN labels_ value (>= 0), run-local
  size                     INTEGER NOT NULL,
  exemplar_page_session_id TEXT NOT NULL,      -- representative page (soft ref -> activity_sessions.id)
  representative_vector    FLOAT[] NOT NULL,   -- FROZEN; dim fixed by embedding_model_id; tracking input
  coherence                DOUBLE,             -- validation score (see §6 / §10)
  time_span_start          TEXT NOT NULL,
  time_span_end            TEXT NOT NULL,
  headline_title           TEXT,               -- labeler
  scope                    TEXT,               -- labeler
  keyphrases               TEXT[],             -- labeler
  display_label            TEXT,               -- labeler
  representation_version   TEXT,               -- labeler logic version
  lifeline_id              TEXT,               -- NULL now; Phase-4 tracking seam
  UNIQUE (run_id, local_label)
);
CREATE INDEX IF NOT EXISTS idx_topic_cluster_run ON topic_cluster(run_id);

-- One row per (run, page). PK enforces one cluster per page per run.
-- Noise is recorded explicitly via is_noise (NOT NULL cluster_id when clustered; no NULL-aware SQL).
CREATE TABLE IF NOT EXISTS topic_cluster_member (
  run_id           TEXT NOT NULL REFERENCES topic_run(id) ON DELETE CASCADE,
  page_session_id  TEXT NOT NULL,                       -- soft ref -> activity_sessions.id
  cluster_id       TEXT REFERENCES topic_cluster(id) ON DELETE CASCADE,  -- set iff NOT is_noise
  is_noise         BOOLEAN NOT NULL DEFAULT FALSE,      -- TRUE => HDBSCAN -1
  probability      DOUBLE NOT NULL,                     -- probabilities_ [0,1]; 0 for noise
  page_loaded_at   TEXT NOT NULL,                       -- denormalized for time filtering
  is_exemplar      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (run_id, page_session_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_member_cluster ON topic_cluster_member(cluster_id);
CREATE INDEX IF NOT EXISTS idx_topic_member_page ON topic_cluster_member(page_session_id);

-- TDT-owned page-vector cache: one embedding per (page, model). Lets re-runs skip
-- re-embedding, and makes a model change a clean cache invalidation.
CREATE TABLE IF NOT EXISTS topic_page_vector (
  page_session_id    TEXT NOT NULL,      -- soft ref -> activity_sessions.id
  embedding_model_id TEXT NOT NULL,      -- matches topic_run.embedding_model_id
  vector             FLOAT[] NOT NULL,   -- L2-normalized page vector; dim fixed by embedding_model_id
  repr               TEXT NOT NULL,      -- page-representation strategy used to build it
  built_at           TEXT NOT NULL,
  PRIMARY KEY (page_session_id, embedding_model_id)
);
```

TDT's micro tier needs only get/put on this cache — clustering runs over a precomputed dense
cosine matrix, not nearest-neighbor search. Downstream similarity search arrives with RAG
(task-31), the first such consumer, which shares this encrypted store and embedding space: at
that point `vector` becomes a fixed-size `FLOAT[dim]` so DuckDB's built-in
`array_cosine_similarity` (and an optional `vss`/HNSW index) can rank it, with `dim` pinned by
`embedding_model_id`.

### Noise representation (resolved)

The review caught an internal contradiction in "absence OR stored." We **commit to PERSIST**
noise, because coverage (`clustered / total in window`) must be derivable from the cluster
tables alone — omitting noise forces a brittle re-join to capture tables and makes "noise"
indistinguishable from "not yet processed." We do **not** use a NULL `cluster_id` sentinel
(it would weaken FK integrity and force NULL-aware SQL); instead a non-null **`is_noise`**
flag, so `coverage = COUNT(*) FILTER (WHERE NOT is_noise) / COUNT(*)` over the window.
`topic_cluster` rows are real clusters only; a noise point is genuinely "in no project," so
it is a member row with `is_noise = TRUE`, not a cluster.

### Run keying, idempotency, invalidation

`run_id = sha256(normalized natural key)` where the natural key is
`(window_start, window_end, params_hash, embedding_model_id, algo_version)`, normalized
(canonical sorted-key param JSON, fixed float formatting, fixed timestamp precision) so two
logically-identical runs hash identically.

- **`params_hash` covers everything that rewrites the input vectors or boundaries**: HDBSCAN
  params, **the pooling strategy**, **the windowing policy** (not just the resolved bounds),
  and any **matryoshka dim**. None of these are visible in the other key columns.
- **`embedding_model_id`** includes TDT's model + dimension + **page-representation rule
  version**, so changing the embedder or the representation produces a new key (and supersedes
  the old run), not a stale cache hit.
- **`algo_version`** bumps on **clustering-tfjs backend change** (CPU/WASM/tfjs-node), not
  only on code change, because tf float/tie-break behavior can alter marginal labels.
- **`input_fingerprint`** hashes the actual clustering inputs — sorted
  `(page_session_id, embedding_vector_version)` — so re-embedding the SAME window (same key)
  is detected as drift and re-clustered; a late-arriving visit whose `page_loaded_at` lands
  in a closed window is likewise caught (capture is async; referrer chains backfill).

Re-running with the same key and same fingerprint is a **no-op** (return the existing
`complete` run). Same key + changed fingerprint, or a forced recompute, does an **atomic
replace** (CASCADE-delete the run's clusters/members, repopulate, flip to `complete`).
Changing model/algo/params yields a **new** key; the prior run for that window is marked
`superseded` (one live run per window; history retained).

### Per-run cost model

A run's marginal cost is **`K` re-downloads** (`K` = new public pages in the window absent
from `topic_page_vector`) **+ `K` embeddings + one `O(n²)` cosine-distance build + one full
HDBSCAN fit over all `n`**. The fit is full-recompute regardless of `K` — there is no append
path. A run whose `input_fingerprint` is unchanged is a **run-level no-op** (above), which is
what makes the automatic trigger (§11 step 9) cheap on quiet days. The real incrementality
mechanism is the **`topic_page_vector` + content caches**: `ok` pages are cache-served, so
re-download happens only for pages absent from the cache. **Excluded pages (auth-walled /
failed re-download) re-fetch live on every run by design** — capture never caches exclusions,
so a page that becomes public later is not pinned to a stale exclusion; there is therefore no
negative-outcome skip. Re-download is bounded only by the politeness gate (per-host interval,
host- and global-concurrency caps), which is what makes any cadence faster than daily
pointless.

### Centroids

The authoritative representative is the **exemplar/medoid `page_session_id`**; its vector is
the page vector TDT computed and cached in `topic_page_vector`. The frozen
`representative_vector FLOAT[]` is stored on the cluster because v1's read paths (labeling,
ranking, and the Phase-4 Hungarian match) need every cluster's representative vector at once —
otherwise an N-cluster cache fan-out per request. It is tagged (via the run's
`embedding_model_id`), so a
model change yields a new run key and the stale vector is never read. The cached vector is the
medoid/exemplar's normalized vector, not a separately-meaning centroid, so cache and authority
answer the same question.

---

## 9. MCP surface

Three read-only, deterministic tools mirroring the existing five verbatim (stdio →
`relational_tool("/query/...")` → HTTP relay; result is
`{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`). They are added to
`vscode/src/mcp_server_standalone.ts` (`ListTools` + `CallTool` cases) and backed by three
new read-only routes in `vscode/src/server/server_manager.ts`, clamped by the existing
`MAX_QUERY_LIMIT`.

```jsonc
{ "name": "list_topic_clusters",
  "description": "List detected topic clusters (project/research threads) overlapping a time range, newest first.",
  "inputSchema": { "type": "object", "properties": {
    "from":  { "type": "string", "description": "ISO 8601 start (inclusive)" },
    "to":    { "type": "string", "description": "ISO 8601 end (exclusive)" },
    "limit": { "type": "number", "description": "Max clusters", "default": 20 } } } }

{ "name": "get_topic_cluster",
  "description": "Return one topic cluster with its label, exemplar page, time span, and member pages (url, title, page_loaded_at, membership probability) ordered by probability descending.",
  "inputSchema": { "type": "object", "properties": {
    "id": { "type": "string", "description": "Topic cluster id" } },
    "required": ["id"] } }

{ "name": "list_clusters_for_page",
  "description": "List the topic clusters a given captured page belongs to, across windows.",
  "inputSchema": { "type": "object", "properties": {
    "page_session_id": { "type": "string", "description": "Captured page session id" } },
    "required": ["page_session_id"] } }
```

Backing routes (single-DuckDB JOINs over `topic_*` × `webpage_*`):

- `GET /query/topic_clusters?from=&to=&limit=` → clusters overlapping `[from,to)`.
- `GET /query/topic_cluster?id=` → cluster + ordered members.
- `GET /query/clusters_for_page?page_session_id=` → clusters containing that page.

A new bulk windowed-range relational read (`GET /query/visits_in_window?from=&to=`) is also
added for TDT's own Stage-1 fetch via the HTTP broker (existing routes are singular-lookup
shaped). Its row cap must accommodate a full window (`<= max_samples`).

Noise is not surfaced as a cluster, but `list_clusters_for_page` returning empty for a page
that _was_ in a clustered window means "this page is a one-off (noise)"; a coverage/noise
count is available per window from `topic_run`.

---

## 10. Dependencies on clustering-tfjs

This module is the consumer driving the library's HDBSCAN upgrade. What v1 strictly needs:

| Library item                                                                                                                                                                                          | Phase                   | v1 need                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pairwise_distance_matrix(X, 'cosine')`                                                                                                                                                               | already shipped         | **Yes** — builds `D` (verified present).                                                                                                 |
| MST(Prim), k-distance, mutual-reachability, condensed-tree                                                                                                                                            | Phase 0                 | **Yes** — HDBSCAN internals.                                                                                                             |
| Cosine as first-class metric (validation metrics)                                                                                                                                                     | Phase 1                 | Partial — see silhouette caveat below.                                                                                                   |
| `HDBSCAN` class: `metric='precomputed'`, `minClusterSize`, `minSamples`, `clusterSelectionMethod`, `clusterSelectionEpsilon`, `storeExemplars`; emits `labels_`, `probabilities_`, `exemplarIndices_` | Phase 2                 | **Yes — the core dependency.** Not yet in `src` (greenfield).                                                                            |
| `select_medoids(X, labels, nClusters, metric)`                                                                                                                                                        | Phase 3                 | **Yes** — representative fallback when `leaf`/no exemplar.                                                                               |
| `exemplarIndices_` accessor                                                                                                                                                                           | Phase 3 (task-55)       | **Yes** — headline/representative. The estimator (Phase 2) can land first; the representative feature is sequenced behind this accessor. |
| `trackClusters(prev, curr, {threshold})`                                                                                                                                                              | Phase 4                 | **No** — tracking is a LATER slice; only the seam (frozen representative vectors, pure-function windows) is banked.                      |
| PCA public estimator                                                                                                                                                                                  | (deferrable)            | **No for v1** — escalation lever only, if the §6 guardrail trips.                                                                        |
| UMAP                                                                                                                                                                                                  | external, never bundled | **Never.**                                                                                                                               |

**Minimum bundle to ship v1:** Phase 0 + Phase 2 (`HDBSCAN` fit-only on a precomputed cosine
distance matrix, emitting `labels_` / `probabilities_` / `exemplarIndices_`) + `select_medoids`
from Phase 3. Phase 1's `cosine` metric flag on KMeans/Spectral is not on the path.

**Validation-metric caveat (verified against source).** `clustering-js`
`silhouette_samples(X, labels)` takes a **data matrix** and **hardcodes Euclidean**; it has
**no `precomputed`/`metric` parameter**. So the cosine `D` fed to HDBSCAN **cannot** be
reused for silhouette — passing `D` as `X` would compute Euclidean distances _between rows of
the distance matrix_ (nonsensical), and passing the page vectors scores in Euclidean (not a
monotone transform of cosine for raw silhouette). Therefore the v1 coherence gate does **not**
claim metric-identical silhouette. It gates on **HDBSCAN-native signals already produced
fit-only** — `cluster_persistence` / mean per-cluster `probabilities_` / cluster size, plus a
DBCV-style density validity if exposed — and **excludes `-1` from any scoring** (the shipped
silhouette is also noise-naive and would score `-1` as a cluster). A precomputed-aware
silhouette is a real library feature (out of scope here); if ever wanted it must run over the
same `D` with noise stripped.

---

## 11. Build order

A phased, testable delivery sequence for THIS module. Each phase is independently verifiable.

1. **Scaffold the package + ports.** Create `tdt/` workspace, add `"tdt"` to root
   `workspaces`, `ports.ts` contracts (`RelationalReader`, `EmbedFn`, `VectorStore`,
   `ClusterSink`, with the clustering-tfjs camelCase↔snake*case translation quarantined here),
   config + types. Fakes for every port. \_Verify:* `tsc` + a no-op `run_tdt` round-trips
   fakes.
2. **Scale + window resolution.** Run the §5 SQL against the live DuckDB to fix the window
   default and confirm the `~5k` ceiling reality. Implement `windowing.ts` (calendar +
   count-guard + gap/calendar subdivision) against fixtures. _Verify:_ window boundaries are
   a pure function of timestamps; oversized windows subdivide deterministically.
3. **Page vectorisation library (task-36.3, done).** Implement the pure `build_page_vector`
   (read already-extracted `PageContent`, build page text, embed via the injected local
   `EmbedFn`, L2-normalize), `resolve_page_vector` (cache get/put through the `VectorStore`
   port), `dedupe_visits`, the dispersion/degenerate/no-text guards, and fixed-order float64
   segment accumulation. _Verified:_ determinism test (same content + pinned model → identical
   page vector), no-text exclusion, and cache hit / invalidation on model-or-repr change.
   3a. **Page-vector store + ingestion-time embedding (task-36.3.1).** The concrete DuckDB
   `topic_page_vector` `VectorStore`, the `on_captured` wiring that builds the page vector at
   ingestion (off the capture hot path) in the same eager-re-download pass, and the
   right-to-forget cascade entry for the store. _Verify:_ a captured page's vector is present in
   `topic_page_vector` after ingestion without TDT running; forgetting a page removes its vector.
4. **Distance + HDBSCAN integration.** `build_cosine_distance_matrix` (clamp/diag/symmetrize)
   - the isolated `cluster_window.ts` call. _Verify:_ bitwise reproducibility test (same
     window twice → identical `labels_` and `probabilities_`); pinned tf backend.
5. **Representations + deterministic labeler.** Exemplar/medoid, frozen representative
   vector, headline + domain scope + title keyphrases. _Verify:_ labels recompose; noise has
   no representative.
6. **Persistence.** `topic_run` / `topic_cluster` / `topic_cluster_member`, run-id hashing,
   idempotency (no-op / atomic-replace / supersede), `is_noise` coverage. _Verify:_ re-run
   same key+fingerprint is a no-op; re-embed bumps `input_fingerprint` and re-clusters.
7. **Validation harness + parameter sweep.** Sweep `window ∈ {14d, month}` ×
   `minClusterSize ∈ {3..8}` × `minSamples ∈ {3,5,8}` × `epsilon ∈ {0, 0.1, 0.2}` on real
   windows; score by HDBSCAN-native validity + noise rate; A/B raw-dim vs PCA-50; confirm a
   known project recovers. **Persist the chosen operating point as config.** _Verify:_ the
   noise-rate guardrail trips → PCA promotion path works.
8. **MCP surface.** Three `/query/topic_*` routes + the `visits_in_window` route + three MCP
   tools. _Verify:_ tools return JSON mirroring the existing five; read-only.
9. **Trigger.** One VS Code command `bergamot.tdt.rebuildClusters` over a pure
   `rebuild_clusters(window_spec)` module function. **Compute runs OFF the extension-host
   event loop** (worker thread / child process, mirroring the MCP server spawn pattern) so a
   multi-second dense `O(n²)` `fit` never freezes the UI or stalls the `/visit` capture
   endpoint; the worker returns raw results and the extension's single writer persists them
   in one short transaction. **An automatic in-host scheduler** (a VS Code extension timer /
   activation-time check) fires the same `rebuild_clusters` entry on a configurable cadence
   (default once/day, the value an evidence-based judgement from the step-7 sweep's
   visits-per-month and per-run re-download volume), with a single-flight guard and §8
   idempotency making quiet-day ticks ~free. An OS cron + headless writer is rejected (it
   violates the single-writer model §3); count-based triggers are rejected (the count guard is
   a windowing invariant, not a trigger). _Verify:_ clustering a real month produces browsable
   clusters via MCP without blocking capture; a scheduled run over an unchanged window is a
   no-op.

---

## 12. Risks & open questions

### Risks (with mitigations)

- **Page-vector dilution (the biggest quality risk).** A whole-page embedding is coarse;
  multi-topic pages (threads, repo pages, index/aggregator pages) land in dead space →
  spurious noise or false bridges. _Mitigation:_ swappable representation seam, dispersion-flag
  → dominant-segment fallback, validation on a labeled window before trusting clusters. Long
  aggregator pages can become cluster magnets that defeat noise rejection — watch and, if
  needed, down-weight or truncate.
- **High-dim over-noising masquerading as success.** Curse-of-dimensionality over-noising
  looks identical to working-as-intended on a dashboard while silently destroying recall on
  medium-coherence threads. _Mitigation:_ the noise-rate/hubness guardrail + the raw-vs-PCA
  A/B + known-project recovery check (§6).
- **Parameter brittleness.** `minClusterSize`/`minSamples`/`epsilon` that fit a busy month
  over-merge a quiet one. _Mitigation:_ the sweep + config (§11), decoupled `minSamples`.
- **`~5k` ceiling on a heavy month.** _Mitigation:_ count guard + gap/calendar subdivision;
  a project spanning a sub-window split fragments until the later tracking slice stitches it.
- **Window-boundary fragmentation.** A project straddling a month edge splits into two
  short-lived clusters. _Mitigation:_ the fix is **hierarchical**, in two complementary layers
  (neither in v1): (1) the cross-window **tracker** (Phase 4) threads the two per-window stubs
  into one lifeline by Hungarian-matching their frozen representative vectors — micro-tier
  continuity; (2) the **SOM macro tier** projects both stubs onto the same boundary-agnostic
  enduring-interest cell, so fragmentation never reaches macro altitude. Both are seamed for
  free via the frozen `representative_vector` + the one shared cosine space. v1 ships honest
  split stubs. **Overlapping windows are rejected** (not merely deferred): they are
  incompatible with the non-overlapping immutable-closed-window idempotency model (§6/§8 key
  runs on `window_start`/`window_end` and memoize closed windows), they duplicate a straddling
  project across frames — forcing dedup at every read surface and double-counting the §8
  coverage/`is_noise` math — and they confer no stable identity (a project longer than the
  overlap still splits).
- **Determinism leaks beyond row order.** float32 non-associativity in pooling; tf-backend
  reduction non-determinism. _Mitigation:_ fixed-order float64 accumulation + pinned backend
  - bitwise regression test (§6).
- **Embedding-model coupling (TDT-owned).** Changing TDT's model or page-representation rule
  shifts cluster ids/labels even with identical visits. _Mitigation:_ `embedding_model_id`
  encodes model + dim + representation version; a change supersedes runs and re-clusters.
- **Event-loop blocking.** A synchronous `fit` on the extension host would freeze the UI and
  stall capture. _Mitigation:_ off-thread compute (§11 step 9).
- **Silhouette metric trap.** The shipped silhouette is Euclidean-only and noise-naive.
  _Mitigation:_ gate on HDBSCAN-native signals, exclude `-1` (§10).
- **tfjs-node prebuilt flakiness on the Intel x64 dev machine.** Prefer the WASM backend as
  the dependable default, tfjs-node as an opt-in accelerator (the library already probes and
  falls back). Whichever is used is pinned and folded into `algo_version`.

### Open questions (incl. the library plan's four)

- **Window size (library Q1).** What is the user's real visits-per-month distribution?
  Determines whether month stays under the ceiling and whether `minClusterSize≈3` is right.
  _Resolved by §11 step 2 against live data — must run first._
- **Embedding model & dim (library Q2).** Which local model does TDT embed with, and at what
  dimension? And does the raw dim or PCA-50 win the §6 A/B? _Measured, not asserted._ (A smaller
  model, e.g. bge-small at 384-d, both eases the curse of dimensionality and is x64-friendly.)
- **Shared space with RAG? (deferred option, not a dependency).** Should TDT eventually adopt
  RAG's embedding model so search hits can be grouped by project cluster? Cheap to align later;
  v1 stays independent (§4).
- **`-1` acceptability (library Q3).** What noise fraction is "healthy" for this user — is
  50% noise expected (half of browsing is one-offs) or a sign of over-strict params? Needs a
  labeled window to calibrate the guardrail threshold; gates the deferred noise re-attachment.
- **Lifeline-id ownership (library Q4).** Cross-window cluster identity is run-local in v1
  (label integers are non-stable). The `lifeline_id` column is reserved but NULL; who owns
  stable lifeline identity (the tracker) and the LLM-name cache key both wait on the tracking
  slice. _Banked as a seam, not built._
- **Pooling strategy.** Does mean, medoid, or top-k best recover known projects? A small A/B
  on real windows; mean is only the default.
- **Page vs navigation-tree as the unit.** v1 fixes the page; whether a tree (session) is a
  better project primitive is the next granularity decision, not assumed settled.
- **Should noise pages be retried** in an adjacent or coarser window before being declared
  unclustered, given boundary fragmentation? Deferred; depends on tracking.
- **Trigger cadence default.** v1 ships an automatic in-host trigger (§11 step 9); the only
  open value is its cadence. Default once/day, finalised as an evidence-based judgement from
  the §11 step 7 sweep's visits-per-month distribution and measured per-run re-download volume.
  _Mechanism in scope; cadence value pending that data._
