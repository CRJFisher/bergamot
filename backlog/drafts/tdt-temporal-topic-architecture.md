# Temporal Topic Detection & Tracking — Architecture Note

High-level design for surfacing evolving and recurring topics from a browsing timeline of timestamped, embedded page visits. Clustering runs on the embedding vectors (doc↔doc cosine); time is a separate axis used for windowing and tracking.

> **Content source.** The embedded content is **re-downloaded public page content**, obtained
> during post-processing from each visit's stored URL — never page content captured at browse
> time. TDT is the **first consumer of the re-download corpus**; RAG comes after. The
> clusterable corpus is the re-downloadable public subset; auth-walled or failed-to-re-download
> visits remain trail/metadata only and are excluded from clustering.
>
> **Detailed plan for the first slice:** the micro tier below is fully scoped in
> [tdt-hdbscan-micro-tier-plan.md](tdt-hdbscan-micro-tier-plan.md) — windowed HDBSCAN
> project detection, the consumer-side architecture in bergamot.

## Two-tier topic model

Topics exist at two altitudes, each served by the algorithm whose properties fit that altitude.

**Macro tier — enduring interests (SOM, online).** A single self-organizing map maintained continuously over the whole stream produces a small, stable set of long-horizon interests. SOM fits because its profile is an advantage here: a fixed grid gives a bounded interest vocabulary, online updates with decay model slow drift without recompute, and incidental noise averages out over long spans.

**Micro tier — bursty topics (HDBSCAN, windowed).** Within each time window (e.g. month), HDBSCAN finds finer, time-limited topics. It fits because the number of topics is unknown and data-driven, one-off pages are rejected as noise rather than forced into a topic, and topics have variable density. Topics are linked across consecutive windows into lifelines (emerge / persist / merge / split / die).

## Linkage between tiers

The two tiers form a hierarchy: each micro topic is placed under a macro interest.

- **Geometry is the backbone.** Both tiers live in the same embedding space, so a micro topic attaches to its macro parent by cosine match — projecting the micro centroid onto the macro map. This is deterministic, cheap, and reproducible.
- **An LLM adjudicates and names.** The LLM names nodes, types the relationship (sub-interest, cross-cutting, or birth of a new macro interest), and resolves cases where geometry is ambiguous. It runs only on new or changed clusters, with decisions cached, so the hierarchy stays stable run to run.

## Invariant

Both tiers and the linkage operate in one shared embedding space and one metric (cosine). Any dimensionality reduction is applied consistently across tiers, or linkage is computed in the original embedding space.

## Build order

1. **Micro tier** — HDBSCAN per window + cross-window tracking + naming. Delivers visible value and proves the embeddings cluster well.
2. **Macro tier** — SOM interest map, surfaced once enough history exists to make it stable.
3. **Linkage** — geometric attachment first, then the LLM adjudicator/namer on top.

Each layer is independently useful. The clustering primitives (HDBSCAN, SOM, cosine, representation accessors, tracking, projection) live in the clustering library; the LLM linkage and hierarchy persistence live in this consumer.
