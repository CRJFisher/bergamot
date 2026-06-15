# @bergamot/tdt

Temporal Topic Detection & Tracking for Bergamot. A pure, dependency-injected
library that groups captured page visits into coherent projects ("research
threads") by embedding similarity, using windowed HDBSCAN clustering. It reads
captured metadata, re-downloads and embeds public page content itself, clusters
per time window, and hands results back for the extension to persist.

## Module boundary

`@bergamot/tdt` is a standalone npm workspace package (sibling of `vscode/`
and `browser/`). It is **pure and dependency-injected**: all I/O — relational
reads, embedding, the page-vector cache, and cluster writes — arrives through
four injected port contracts. The package owns the clustering logic and the
`clustering-tfjs` camelCase↔snake_case naming translation; it owns nothing else.

**This package imports:**

- its own modules (`ports`, `types`, `config`, and the clustering stages)
- `clustering-tfjs` (HDBSCAN, pairwise cosine distance) — at the single
  isolated clustering stage only (`src/cluster_window.ts`)
- `@xenova/transformers` — behind the `EmbedFn` port implementation only

**This package never imports:**

- anything under `vscode/src` (the VS Code extension internals: `duck_db.ts`,
  the express server in `server/`, the re-download pipeline in `redownload/`,
  `mcp_server_standalone.ts`, etc.)
- the `vscode` extension API
- `node:fs`, `express`, `patchright`, or any other concrete I/O dependency

The dependency direction is one-way: `vscode/` depends on `@bergamot/tdt`;
`@bergamot/tdt` never depends on `vscode/`.

## Port contracts

All four are defined in `src/ports.ts`. The library calls them; the caller
supplies the concrete implementations.

- **`RelationalReader`** — reads captured visit rows from DuckDB for a time
  window (`list_visits_in_window(start, end)`), ordered deterministically by
  `page_loaded_at, page_session_id`. Supplied by the extension: in-process
  reader functions when TDT runs inside an extension command, or the HTTP
  `/query/visits_in_window` broker when it runs as the batch CLI. TDT never
  opens the capture DuckDB file directly.

- **`EmbedFn`** — a callable `(text: string) => Promise<Float32Array>`.
  TDT's own local text-embedding model, independent of the RAG pipeline.
  Supplied by the extension over a local model (e.g. a sentence encoder via
  `@xenova/transformers`).

- **`VectorStore`** — the page-vector cache (`topic_page_vector` table): read
  a cached L2-normalized page vector for `(page_session_id, embedding_model_id)`,
  write a freshly built one. Supplied by the extension's DuckDB writer so
  re-runs reuse cached vectors and a model change is a clean cache invalidation.

- **`ClusterSink`** — the write path for clustering results: `write_run`,
  `write_clusters`, `write_members`. Supplied by the extension's single DuckDB
  writer, which persists the handed-back results in one short transaction. The
  batch CLI does read+compute only and supplies no sink.

## Wiring it up

The caller constructs `TdtDeps` from concrete implementations and passes it to
`run_tdt`. For tests, in-memory fakes for every port live in `src/fakes/`:

```ts
import { run_tdt, type TdtDeps, type TdtArgs } from "@bergamot/tdt";
import {
  FakeRelationalReader,
  create_fake_embed,
  FakeVectorStore,
  FakeClusterSink,
} from "@bergamot/tdt/src/fakes";

const { embed } = create_fake_embed();
const sink = new FakeClusterSink();

const deps: TdtDeps = {
  reader: new FakeRelationalReader([/* seeded VisitRow[] */]),
  embed,
  vectorStore: new FakeVectorStore(),
  sink,
};

await run_tdt(deps, {
  window_start: "2026-05-01T00:00:00Z",
  window_end: "2026-06-01T00:00:00Z",
  embedding_model_id: "bge-small-en@384#repr-v1",
});
```

In production the same shape is built from the extension's DuckDB reader, the
local embedder, the `topic_page_vector` cache writer, and the single-writer
cluster sink.

## Build and test

```sh
npm run build --workspace tdt
npm run test --workspace tdt
```

`tsc` extends `../tsconfig.base.json` (strict, ES2022). Tests run under Jest
with `ts-jest`.
