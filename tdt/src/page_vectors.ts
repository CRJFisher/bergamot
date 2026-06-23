/**
 * Page vectorisation — TDT owns turning one re-downloaded public page into one
 * L2-normalized page vector (plan §4). This is where TDT's independence from the
 * RAG pipeline is realised: the embedding INPUT is already-extracted public
 * content read from the task-39.2 corpus, embedded by TDT's OWN injected local
 * model. No RAG chunk vectors, no LanceDB, no fetching, no HTML parsing — pages
 * are re-downloaded eagerly and cached upstream; TDT consumes the extracted
 * content via {@link PageContent}.
 *
 * Everything here is a pure deterministic transform: given fixed content, a
 * fixed representation rule, a fixed config, and a pinned embedder (same text →
 * byte-identical vector), the output bytes are identical regardless of the order
 * pages are processed. Determinism anchors: NFC + fixed whitespace normalization,
 * code-point-offset slicing (never locale/grapheme boundary search), sequential
 * in-order embedding, fixed-order float64 accumulation for every sum, and exactly
 * one float32 truncation at the final store.
 */

import type { EmbedFn, VectorStore } from "./ports";
import type { PageContent, PageRepr, PageVector, VisitRow } from "./types";
import type { PageVectorConfig } from "./config";

// ---------------------------------------------------------------------------
// Text construction — deterministic page-level text (repr-rule-v1)
// ---------------------------------------------------------------------------

// The whitespace-equivalent set folded to a normal space before collapsing:
// non-breaking, ideographic, en/em, zero-width-ish separators that \s misses.
const WHITESPACE_EQUIVALENTS =
  /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/gu;

// NFC, fold separators, collapse runs to one ASCII space, trim. A string that is
// empty or all-whitespace/zero-width normalizes to "" — the no-text predicate.
function normalize_text(s: string): string {
  return s
    .normalize("NFC")
    .replace(WHITESPACE_EQUIVALENTS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// First `n` code points (surrogate-safe, deterministic, no boundary search).
function take_code_points(s: string, n: number): string {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join("");
}

// Non-overlapping consecutive runs of `size` code points; ≥1 non-empty segment
// for non-empty input. Code-point (not UTF-16) offsets so a surrogate pair is
// never split, keeping segmentation identical across runs.
function segment_by_code_points(s: string, size: number): string[] {
  const cps = Array.from(s);
  if (cps.length <= size) return [s];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i += size) {
    out.push(cps.slice(i, i + size).join(""));
  }
  return out;
}

// title_plus_lead: title + the lead (first lead_chars of content).
// main_content_extract: title + full content. The outer normalize collapses the
// joiner space when either side is empty.
function build_page_text(
  content: PageContent,
  repr: PageRepr,
  config: PageVectorConfig,
): string {
  const title = normalize_text(content.title);
  const body = normalize_text(content.content);
  const lead =
    repr === "title_plus_lead" ? take_code_points(body, config.lead_chars) : body;
  return normalize_text(`${title} ${lead}`);
}

// ---------------------------------------------------------------------------
// Vector math — all in float64, fixed iteration order
// ---------------------------------------------------------------------------

function widen(v: Float32Array): Float64Array {
  const out = new Float64Array(v.length);
  for (let d = 0; d < v.length; d++) out[d] = v[d]; // f32 ⊂ f64, exact
  return out;
}

function l2_norm(v: Float64Array): number {
  let sum = 0;
  for (let d = 0; d < v.length; d++) sum += v[d] * v[d];
  return Math.sqrt(sum);
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let d = 0; d < a.length; d++) sum += a[d] * b[d];
  return sum;
}

// L2-normalized copy, or the all-zeros vector when the segment is degenerate
// (norm < eps). A zero unit vector yields cosine 0 against anything — the
// correct "no information" treatment — and never divides by ≈0 (no NaN/Inf).
function unit_or_zero(v: Float32Array, eps: number): Float64Array {
  const w = widen(v);
  const norm = l2_norm(w);
  if (norm < eps) return new Float64Array(v.length);
  const inv = 1 / norm;
  for (let d = 0; d < w.length; d++) w[d] = w[d] * inv;
  return w;
}

// Mean cosine over all unordered segment pairs (fixed i<j order). units are
// already L2-normalized (or zero), so cosine is their dot product.
function mean_pairwise_cosine(units: Float64Array[]): number {
  const n = units.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) sum += dot(units[i], units[j]);
  }
  return sum / ((n * (n - 1)) / 2);
}

// The medoid: the segment whose direction is most central (max summed cosine to
// the others) — a real sub-topic, not the mean's dead space between sub-topics.
// Strict-greater replacement makes the lowest index win ties (deterministic).
function medoid_index(units: Float64Array[]): number {
  let best_i = 0;
  let best_score = -Infinity;
  for (let i = 0; i < units.length; i++) {
    let score = 0;
    for (let j = 0; j < units.length; j++) {
      if (j !== i) score += dot(units[i], units[j]);
    }
    if (score > best_score) {
      best_score = score;
      best_i = i;
    }
  }
  return best_i;
}

// Fixed-order float64 mean: accumulate in segment-then-dim ascending order,
// multiply by the reciprocal once. IEEE-754 addition is non-associative, so the
// order is load-bearing for the bitwise-determinism contract.
function mean_pool(seg_vecs: Float32Array[], dim: number): Float64Array {
  const acc = new Float64Array(dim);
  for (let s = 0; s < seg_vecs.length; s++) {
    const v = seg_vecs[s];
    for (let d = 0; d < dim; d++) acc[d] += v[d];
  }
  const inv_n = 1 / seg_vecs.length;
  for (let d = 0; d < dim; d++) acc[d] = acc[d] * inv_n;
  return acc;
}

// ---------------------------------------------------------------------------
// build_page_vector — the pure (content, repr, config) × embed → vector | null
// ---------------------------------------------------------------------------

/**
 * Build one L2-normalized page vector by embedding a deterministic page-level
 * text. Pages over the embedder's budget are split into segments, embedded, and
 * mean-pooled (a throwaway internal split — NOT RAG chunking; no contextual
 * prefixes, no persistence).
 *
 * Returns `null` for the exclusions that must never reach the cosine matrix:
 * a page with no extractable text, or one whose embedding is truly degenerate
 * (norm < ε even after fallback). The dispersion guard (multi-topic page →
 * dominant segment) and the degenerate guard (pooled mean collapses → dominant
 * segment) set `low_confidence` on the returned vector.
 *
 * @throws RangeError if the embedder returns inconsistent dimensions across
 *         segments — a misconfigured/nondeterministic embedder, fail loud.
 */
export async function build_page_vector(
  content: PageContent,
  embed: EmbedFn,
  repr: PageRepr,
  config: PageVectorConfig,
): Promise<PageVector | null> {
  const text = build_page_text(content, repr, config);
  if (text === "") return null; // no-text exclusion — never embed empty text

  const segments = segment_by_code_points(text, config.segment_chars);

  // Embed strictly in ascending-segment order (NOT Promise.all): order is part
  // of the determinism contract and keeps the embed-call sequence inspectable.
  const seg_vecs: Float32Array[] = [];
  for (const seg of segments) {
    seg_vecs.push(await embed(seg));
  }

  const dim = seg_vecs[0].length;
  if (dim === 0) return null; // empty embedding carries no signal
  for (let i = 1; i < seg_vecs.length; i++) {
    if (seg_vecs[i].length !== dim) {
      throw new RangeError(
        `build_page_vector: embedding dim mismatch for ${content.page_session_id}: ` +
          `${seg_vecs[i].length} != ${dim}`,
      );
    }
  }

  const eps = config.degenerate_norm_epsilon;
  let candidate: Float64Array;
  let low_confidence = false;

  if (seg_vecs.length === 1) {
    // No pairwise dispersion for a single segment.
    candidate = widen(seg_vecs[0]);
  } else {
    const units = seg_vecs.map((v) => unit_or_zero(v, eps));
    if (mean_pairwise_cosine(units) < config.dispersion_min_mean_cosine) {
      // Multi-topic: a mean would land in dead space between sub-topics.
      candidate = widen(seg_vecs[medoid_index(units)]);
      low_confidence = true;
    } else {
      const pooled = mean_pool(seg_vecs, dim);
      if (l2_norm(pooled) < eps) {
        // Backstop: aligned segments whose mean still collapsed numerically.
        candidate = widen(seg_vecs[medoid_index(units)]);
        low_confidence = true;
      } else {
        candidate = pooled;
      }
    }
  }

  // Single normalization point for every path; the only float32 truncation.
  const norm = l2_norm(candidate);
  if (norm < eps) return null; // truly degenerate — excluded like no-text
  const inv = 1 / norm;
  const out = new Float32Array(dim);
  for (let d = 0; d < dim; d++) out[d] = candidate[d] * inv;

  return { page_session_id: content.page_session_id, vector: out, low_confidence };
}

// ---------------------------------------------------------------------------
// resolve_page_vector — cache-aware build through the VectorStore port
// ---------------------------------------------------------------------------

/**
 * Resolve a page's vector through the page-vector cache (plan §8). Returns the
 * cached vector on a hit (no embedding), otherwise builds, persists, and returns
 * it. Returns `null` for an excluded page (no usable text / truly degenerate)
 * and caches nothing — re-evaluating next run is cheap and the schema models no
 * exclusion tombstone.
 *
 * Returns the bare vector (the cache unit), not a {@link PageVector}: the cache
 * stores only `(page_session_id, embedding_model_id, repr, vector)`, so a cache
 * hit cannot reconstruct `low_confidence`. That flag is a build-time diagnostic;
 * a caller that needs it calls {@link build_page_vector} directly.
 *
 * Invalidation: the cache key is `(page_session_id, embedding_model_id)`, and
 * `embedding_model_id` encodes model + dim + representation-rule version (e.g.
 * `bge-small-en@384#repr-v1`). A model OR representation change therefore yields
 * a new key — a clean miss — so no stale vector survives. `repr` is recorded in
 * its own column for forensics, not as part of the key.
 */
export async function resolve_page_vector(
  content: PageContent,
  embed: EmbedFn,
  vector_store: VectorStore,
  embedding_model_id: string,
  repr: PageRepr,
  config: PageVectorConfig,
): Promise<Float32Array | null> {
  const cached = await vector_store.get(content.page_session_id, embedding_model_id);
  if (cached !== null) return cached;

  const built = await build_page_vector(content, embed, repr, config);
  if (built === null) return null;

  await vector_store.put(content.page_session_id, embedding_model_id, repr, built.vector);
  return built.vector;
}

// ---------------------------------------------------------------------------
// dedupe_visits — collapse repeat same-URL visits within one navigation tree
// ---------------------------------------------------------------------------

/**
 * Collapse repeat same-URL visits within one navigation tree (a back/forward or
 * refresh that re-loads the same page) to a single clustering unit, so reloads
 * don't inflate cluster density. The same URL in a DIFFERENT tree is a distinct
 * browsing context and is kept.
 *
 * Keeps the earliest visit per `(tree_id, url)`. The input MUST arrive sorted by
 * `(page_loaded_at, page_session_id)` ascending — the contract `compute_windows`
 * already guarantees — so a first-wins pass keeps the earliest while preserving
 * the surviving subsequence's order (the stable row order the distance matrix
 * downstream depends on). Pure and deterministic; never mutates the input.
 */
export function dedupe_visits(visits: VisitRow[]): VisitRow[] {
  const seen = new Set<string>();
  const out: VisitRow[] = [];
  for (const v of visits) {
    // NUL separator: tree_id and url cannot both contain it, so keys never alias.
    const key = `${v.tree_id}\u0000${v.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
