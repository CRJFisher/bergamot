# State-of-the-Art RAG Pipeline: Architecture & Upgrade Plan

This document defines the target retrieval-augmented generation (RAG) architecture for Bergamot and the phased plan to reach it. It synthesises fact-checked 2024–2026 research (sources at the end) and maps each technique onto Bergamot's stack: a TypeScript/Node pipeline that ingests noisy web pages into **DuckDB** (relational visit records) + **LanceDB** (vectors), exposed through an **MCP server**.

The goal is a _measured, production-grade_ RAG pipeline — the kind whose quality is proven by metrics, not asserted.

## Current pipeline (baseline)

| Stage              | Current implementation                                                               |
| ------------------ | ------------------------------------------------------------------------------------ |
| Ingestion          | LLM extracts main content → stored in DuckDB + LanceDB (`simple_workflow.ts`)        |
| Chunking           | **None** — each whole page is stored as a single LanceDB record                      |
| Embedding          | OpenAI `text-embedding-3-small`, single dense vector (`workflow/embeddings.ts`)      |
| Index              | LanceDB vector search (IVF family)                                                   |
| Retrieval          | **Pure dense** similarity; no keyword/BM25, no fusion (`mcp_server.ts`)              |
| Reranking          | None                                                                                 |
| Query handling     | Query embedded verbatim; no transformation                                           |
| Generation surface | `semantic_search` returns 200-char previews; `get_webpage_content` returns full page |
| Evaluation         | **None** (only a chunk-size research note exists)                                    |

Every modern technique below is an _additive_ improvement over this baseline.

## Target architecture

```
[captured page]
  → main-content extraction (heuristic prune of nav/footer/aside/ads)        [Phase B]
  → structure-aware chunking + LLM-prepended contextual situating text       [Phase C]
  → embed (model chosen by measured retrieval quality) → LanceDB             [Phase G]
  → DuckDB holds chunk↔page linkage + metadata for filtering / parent lookup

[query]
  → optional query transformation (HyDE / multi-query / route)               [Phase F]
  → hybrid retrieval: dense + BM25/FTS fused via Reciprocal Rank Fusion       [Phase D]
  → rerank top-N candidates (cross-encoder / hosted reranker)                 [Phase E]
  → parent-document expansion (chunk hit → full page) + context ordering      [Phase H]
  → MCP tool result with citations / attribution                             [Phase H]

[every phase measured against the evaluation harness]                        [Phase A]
```

## Findings → design decisions

Each decision below is tagged with the verified research finding that justifies it. Percentages are Anthropic's own benchmarks on their own technique (accurate as reported, best-case vendor numbers — which is exactly why we re-measure on our own corpus via the harness).

### A. Evaluation harness first (the spine)

"Production RAG" means _measured_ RAG. Before changing retrieval we build a golden dataset (queries → known-relevant captured pages, drawn from the user's own corpus) and a metrics suite: retrieval metrics (Recall@k, MRR, nDCG) and generation metrics (context precision/recall, faithfulness, answer relevance) scored with an LLM-as-judge in the RAGAS style. Every later phase reports a delta against this baseline. This is also the portfolio centrepiece.

### B. Clean ingestion — heuristic main-content extraction

Noisy web HTML carries nav bars, footers, asides, ad containers, and social widgets that pollute embeddings. Heuristic (non-ML) extractors (Trafilatura-style: tree-pruning + link-density analysis) recover main article text and are competitive with neural extractors. We prune before the existing LLM content step so the model — and the vectors — see clean text. _(Do not cite specific F1 leaderboard numbers — that specific claim was refuted in research.)_

### C. Chunking + Contextual Retrieval (highest single-technique ROI)

Replace whole-page embedding with structure-aware chunks (markdown-header / recursive). Then apply **Anthropic Contextual Retrieval**: for each chunk, pass the chunk _plus its full source page_ to an LLM to generate 50–100 tokens of chunk-specific situating context, prepended to the chunk **before both embedding and BM25 indexing**. Measured effect: contextual embeddings alone cut top-20 retrieval failures by **35%**; with contextual BM25 by **49%**. Pair with **parent-document retrieval** — a chunk hit returns its full page (via DuckDB chunk↔page linkage) so the agent gets complete context.

### D. Hybrid search — LanceDB-native dense + BM25, fused via RRF (lowest-cost upgrade)

LanceDB natively supports hybrid search in the embedded **TypeScript** SDK: a dense vector query plus a full-text/BM25 (Tantivy) index, merged by **Reciprocal Rank Fusion** (`RRFReranker()` is the built-in default). This delivers hybrid retrieval from the _existing_ store with no separate search engine. Anthropic's default fusion weighting is ~0.8 semantic / 0.2 BM25 — a starting point to tune on our harness.

### E. Reranking

Add a reranking stage over the top-N hybrid candidates (LanceDB exposes pluggable rerankers: cross-encoder, Cohere, etc.). Stacking reranking onto contextual hybrid retrieval reached a **67%** reduction in retrieval failures in Anthropic's benchmark. Clear high-ROI add-on; choose the concrete reranker by measured ROI on our corpus.

### F. Query transformation (optional, behind config)

**HyDE** generates a hypothetical answer document from the query and retrieves by its embedding — strong for zero-shot / label-poor retrieval and comparable to fine-tuned retrievers. Add HyDE and multi-query rewriting as toggles, plus a lightweight router deciding _whether_ to retrieve. Keep optional; measure marginal gain before defaulting on.

### G. Embedding model selection — by measured retrieval, not overall MTEB average

No single embedding model dominates all MTEB task categories; a top _overall_ model can rank lower on **Retrieval**. Select by the Retrieval-relevant metrics on our own golden dataset (Recall/nDCG) and cost, not headline averages. Evaluate candidates and consider matryoshka dimension-trimming to cut storage. `text-embedding-3-small` is the incumbent to beat.

### H. Generation-time surface (MCP)

Combat _lost-in-the-middle_ by ordering the most relevant context at the edges; return **citations/attribution** (source URL + chunk) in MCP results; use structured outputs. Short-circuit per Anthropic's guidance: for a knowledge base under **~200K tokens (~500 pages)**, skip retrieval and put the whole corpus in the prompt — Bergamot should detect small corpora and offer a whole-corpus path.

## Explicitly deferred (YAGNI for a baseline PKM)

These are well-documented but solve specialised problems and carry real cost/complexity. Captured here so they are _deferred deliberately_, not forgotten — revisit only when a concrete need appears.

- **GraphRAG** — entity-graph + community-summary map-reduce. Wins on _global, corpus-wide sensemaking_ ("what are the main themes?") that naive RAG can't answer (57–64% win rates on comprehensiveness/diversity). Revisit if/when "summarise my whole knowledge base" becomes a first-class use case.
- **Agentic RAG** — autonomous agents (reflection/planning/tool-use) for multi-step reasoning over the KB. Revisit if multi-hop reasoning becomes core.
- **Self-RAG** — a model trained with reflection tokens to retrieve adaptively. Requires custom model training; out of scope.
- **CRAG (Corrective RAG)** — confidence-scored retrieval evaluator with web-search fallback. Plug-and-play; revisit if retrieval-quality failures persist _after_ the baseline upgrades above.

## ROI ordering (what to build, in order)

1. **Evaluation harness** (A) — precondition for measuring everything else.
2. **Hybrid search** (D) — lowest cost, native to LanceDB, immediate win.
3. **Chunking + Contextual Retrieval + parent-document** (C) — largest single-technique gain.
4. **Reranking** (E) — stacks to the biggest cumulative failure reduction.
5. **Clean ingestion** (B) — quality of inputs; can land in parallel with C.
6. **Embedding model selection** (G) — once the harness can adjudicate candidates.
7. **Query transformation** (F) — marginal, optional.
8. **MCP generation-time polish** (H) — citations, ordering, small-corpus short-circuit.
9. **Advanced architectures** — deferred; decision record only.

## Sources (fact-checked, 2024–2026)

- Anthropic — _Introducing Contextual Retrieval_: https://www.anthropic.com/news/contextual-retrieval
- Anthropic / Claude cookbook — _Contextual Embeddings guide_: https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide
- LanceDB docs — _Hybrid Search_: https://docs.lancedb.com/search/hybrid-search
- LanceDB docs — _Reciprocal Rank Fusion_: https://lancedb.com/documentation/reranking/rrf/
- LanceDB docs — _Vector Index (IVF / HNSW sub-index / quantization)_: https://docs.lancedb.com/indexing/vector-index
- MTEB — _Massive Text Embedding Benchmark_ (paper): https://arxiv.org/abs/2210.07316; selection guidance: https://modal.com/blog/mteb-leaderboard-article
- Trafilatura (heuristic web extraction): https://deepwiki.com/adbar/trafilatura
- GraphRAG — Microsoft Research: https://arxiv.org/abs/2404.16130
- Agentic RAG survey: https://arxiv.org/abs/2501.09136
- Self-RAG (ICLR 2024): https://arxiv.org/abs/2310.11511
- CRAG / Corrective RAG (ICML 2024): https://arxiv.org/abs/2401.15884
- HyDE (ACL 2023): https://arxiv.org/abs/2212.10496

_Caveat: all retrieval-improvement percentages are Anthropic's own benchmarks on their own technique and embedding models — accurate as reported but best-case and not independently reproduced. The 200K-token threshold tracks Claude's then-default context window. This is exactly why Phase A (the harness) measures every change on Bergamot's own corpus._
