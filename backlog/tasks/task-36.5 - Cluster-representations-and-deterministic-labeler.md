---
id: TASK-36.5
title: Cluster representations and deterministic labeler
status: Done
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-26 00:00"
labels: []
dependencies:
  - TASK-36.4
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

> **Branch:** all TDT work commits to the `tdt` branch.


## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Give each cluster a representative page and a human-readable label without an LLM. The representative is the eom exemplar (exemplarIndices\_), falling back to select_medoids when no exemplar is defined; noise (-1) has no representative. Each cluster also gets a frozen L2-normalized representative vector — consumed now for labeling/ranking and banked as the input the later cross-window tracker needs.

The deterministic labeler produces label fields stored separately (never one baked string) so the UI can recompose and a later LLM can consume the bundle: headline_title (the exemplar page's title), scope (registrable-domain distribution), cheap keyphrases from already-available <head> metadata, a composed display_label, and a representation_version. No LLM and no window-relative c-TF-IDF in this slice. The LLM-naming path is left as a documented interface seam only — not implemented, and no dead config flag is shipped.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §7 (Cluster representation & labeling).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [x] #1 Each cluster exposes a representative page_session_id (eom exemplar, else select_medoids fallback) and a frozen L2-normalized representative vector; noise has no representative
- [x] #2 A deterministic labeler produces headline_title, scope (registrable-domain distribution), keyphrases, display_label, and representation_version as separate fields, with no LLM and no per-window c-TF-IDF
- [x] #3 Label fields recompose into a display string, and unit tests assert determinism and recomposition
- [x] #4 The LLM-naming seam (interface boundary plus stable-core fingerprint) is documented but not implemented, and no default-off config flag for it is shipped
<!-- AC:END -->

## Implementation Notes

### High-level summary

This slice turns the run-local HDBSCAN output into something a person can read: each cluster gets a representative page and a deterministic, no-LLM label. It is build-order step 5 of the TDT micro tier, sitting between the clustering core (TASK-36.4) and persistence (TASK-36.6). The clustering core emits an in-memory `HdbscanRaw` (`labels`, `probabilities`, `exemplar_indices`); this slice consumes it and produces `RepresentedCluster[]` plus a `ClusterLabel` per cluster. Nothing is persisted here and no `page_session_id` strings are resolved — the `RepresentedCluster` carries a `representative_index` into the window's row space, and TASK-36.6 resolves it to `exemplar_page_session_id` when it writes `topic_cluster`.

[representations.ts](../../tdt/src/representations.ts) owns `represent_clusters`. For each cluster (label ≥ 0; noise produces nothing) it picks the representative — the `eom` exemplar when the library stored one, else a lazy `select_medoids` cosine fallback computed once over the full array — and freezes a representative vector: the L2-normalized mean of the member vectors, accumulated in float64 in ascending row order with a single float32 truncation, so it is bitwise-reproducible independent of the TensorFlow backend (it is banked now as the Phase-4 cross-window tracker's Hungarian-match input). The three inputs (`raw`, `vectors`, `visits`) are parallel arrays describing the same rows; that alignment is load-bearing, so it is asserted fail-loud up front (length parity and a per-row `page_session_id` cross-check).

[labeling/deterministic_labeler.ts](../../tdt/src/labeling/deterministic_labeler.ts) owns `label_cluster`, which builds a bundle of **separate** fields — never one baked string — so the UI can recompose and a future LLM can consume the evidence: `headline_title` (the representative page's title), `scope` (the registrable-domain distribution via `tldts`), `keyphrases` (term frequency over the member titles), `display_label`, and `representation_version`. `display_label` is produced by the pure `compose_display_label`, which the recomposition tests call to prove the string is derivable from the parts, not stored independently. [labeling/llm_naming_seam.ts](../../tdt/src/labeling/llm_naming_seam.ts) documents the future LLM-rewrite boundary and its geometric stable-core cache key as **types only** — no implementation, no config flag.

To navigate: start at `represent_clusters` (the upstream contract and the index-alignment invariant), then `label_cluster` (which indexes the same `visits` array). The tricky parts are the frozen-vector determinism and degenerate fallback in `frozen_representative_vector`, and the deterministic total orders (domains, keyphrases) in the labeler's helpers.

### Decisions

- **`tldts` (pinned exact `6.1.86`) for registrable-domain extraction.** A true eTLD+1 (so `docs.google.com` and `mail.google.com` collapse to `google.com`, and `foo.co.uk` is handled) needs the Public Suffix List — real external data a hand-rolled "last two labels" heuristic gets wrong. `tldts` is offline, deterministic, and pure (no native deps), so the labeler stays barrel-safe. The version is pinned exactly because the bundled PSL snapshot is part of the labeler's determinism surface.
- **`keyphrases` is in-house term frequency over titles, NOT a library and NOT c-TF-IDF.** Per plan §7 the genuine corpus-relative extraction (c-TF-IDF) is deferred to the LLM namer because it is window-relative — the same project would get different keyphrases as its window neighbours change, hostile to the cross-window label stability tracking needs. The v1 field is frequency over the cluster's own titles (corpus-independent, ~15 lines); the typed field + `representation_version` are the seam for a richer extractor later. A keyword library was rejected: the maintained ones pull version-sensitive English POS/stemming that would churn labels, and the lightweight ones are unmaintained and amount to what we inline.
- **The frozen representative vector is computed in pure JS, not reused from `select_medoids`' internal mean.** `select_medoids` computes a float32 mean on a tf backend in library-internal order; the persisted representative vector must be backend-independent and byte-stable, so it is a separate float64 fixed-order computation. On a near-antipodal collapse (mean norm < ε) it falls back to the representative member's own unit vector — never a near-zero direction, which would read as "orthogonal to everything" and silently corrupt the tracker's cosine match (a deliberate divergence from `page_vectors.ts`, which zeroes degenerate segments).
- **`select_medoids` is the named library fallback, called lazily over the full array.** Under the v1 `eom` + `store_exemplars` defaults every cluster has an exemplar, so the medoid path never fires in practice, but AC#1 and plan §10 require the library function; it runs once over the whole parallel array (it groups per label itself) only when some cluster lacks an exemplar, guarded by a label-contiguity check.
- **`representations.ts` and the labeling modules stay out of the `@bergamot/tdt` barrel.** `representations.ts` imports `clustering-tfjs` (pulls the native TensorFlow chain), mirroring `cluster_window.ts`; the labeling modules are internal pipeline stages / a not-yet-built seam. Only the `ClusterLabel` DTO is re-exported, since the persist adapter and MCP surface reference it. `ClusterLabel` lives in `types.ts`; `LabelerConfig` / `LABELER_VERSION` live with the labeler (they are not part of the TASK-36.7 validation sweep, unlike the configs in `config.ts`).

### Verification

126 `@bergamot/tdt` unit tests pass (1 `todo`), both `tsc` configs clean. New coverage: representative selection (exemplar, the `select_medoids` cosine-medoid fallback, mixed exemplar/medoid across clusters, in-range resolution); noise has no representative (one cluster + noise → one `RepresentedCluster`, all-noise → `[]`, empty window → `[]`); the frozen vector is the unit-norm L2 mean, non-aliasing, ignores noise rows, byte-identical across repeated calls, and falls back to the representative member's unit vector on antipodal collapse; the fail-loud alignment guards (length parity, `page_session_id` mis-zip, non-contiguous labels); `time_span` ordered by parsed instant across mixed UTC ISO forms. Labeler coverage: separate fields and the representative-title headline; `scope` collapsing subdomains to the eTLD+1, the `co.uk` suffix, the multi-domain `+N site(s)` form, and `scope=""` when no URL parses; `keyphrases` term-frequency ranking, stopword/short-token removal, code-unit tie-breaking, case folding, the title cap, whitespace-only-title trim, and corpus-independence; recomposition (`compose_display_label` reproduces `display_label`) and determinism across single-domain / multi-domain / empty fixtures and member input order; and the AC#4 guards that no LLM-naming config flag or runtime namer export is shipped.
