# Work Priority

## Current Status

Bergamot is a lean capture-to-query pipeline. The browser extension captures
web-page visits and stitches them into cross-page navigation sessions, posts
them to the VS Code HTTP server, and the server persists each visit into DuckDB
(relational record) and LanceDB (page text + vectors). An LLM categorizes and
extracts the main content of each page during ingestion. The stored record is
queryable through an MCP server, an HTTP query API, and direct read-only DuckDB
access.

The infrastructure for that core is in place:

- ✅ Cross-tab E2E test coverage (Playwright, MV3 extension, real visit records)
- ✅ Single authenticated local HTTP transport with port-range discovery
- ✅ DuckDB + LanceDB ingestion wired end-to-end via `simple_workflow.ts`
- ✅ Durable visit inbox — in-flight visits survive restarts
- ✅ Relational MCP tools + HTTP query API over the DuckDB record
- ✅ Semantic search MCP tool over LanceDB content
- ✅ LLM webpage filtering and content extraction (direct OpenAI calls)
- ✅ `Bergamot: Search Webpages` and `Bergamot: Show Filter Metrics` commands

## Next Priority Areas

### 1. RAG pipeline (task 31 series)

The biggest lever. Build a measured, production-grade retrieval pipeline on the
existing DuckDB + LanceDB stores: evaluation harness first, then hybrid search
(dense + BM25 via RRF), chunking + contextual retrieval + parent-document
expansion, reranking, clean ingestion, and embedding-model selection. See
`backlog/docs/rag-pipeline-upgrade-plan.md`.

### 2. Image-aware content extraction

Extend the ingestion content extraction to handle images on captured pages so
visual knowledge is represented in the stored record and retrievable.

### 3. Query-interface completeness

Round out the query surface over the existing stores:

- Sort-by-time ordering on query results
- Date-range filtering
- Hybrid (relational + semantic) search across MCP / HTTP query API

## Technical Debt & Improvements

- Optimize DuckDB queries for large datasets
- Add performance benchmarks for ingestion and query paths
- Reduce duplication in E2E test helpers
