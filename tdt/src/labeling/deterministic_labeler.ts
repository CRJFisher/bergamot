// The deterministic, no-LLM labeler (plan §7, build-order step 5). Produces a
// ClusterLabel bundle of SEPARATE fields from already-captured <head> metadata
// (the representative page's title, member URLs and titles) — no re-download, no
// HTML parse, no window-relative c-TF-IDF, no LLM. The genuine corpus-relative
// keyword extraction (c-TF-IDF) and the LLM rewrite are deferred (see §7 and
// llm_naming_seam.ts); the typed keyphrases field + representation_version are
// the seam for swapping a richer extractor in later.
//
// Pure and tf-free: the only non-stdlib import is `tldts` (the offline Public
// Suffix List, for registrable-domain extraction). Determinism comes from stable
// total orders — domains by (count desc, domain asc), keyphrases by (frequency
// desc, token asc), all string ties broken by code-unit order (never
// localeCompare) — and from locale-independent toLowerCase (never
// toLocaleLowerCase, which would fold Turkish dotless-i differently per host).
//
// `visits` is the window's VisitRow[] in the same row order as the page-vector
// matrix; RepresentedCluster.member_indices / representative_index index into
// it. The orchestrator (TASK-36.9) passes the same array to represent_clusters
// and label_cluster.

import { getDomain } from "tldts";

import type { ClusterLabel, RepresentedCluster, VisitRow } from "../types";

// Bump when ANY label-construction logic changes (tokenization, stopwords,
// min_token_len, the scope/display templates, or the keyphrase cap) — the field
// is what lets a consumer detect a relabel. NOT bumped for representative-vector
// geometry, which is provenance carried by embedding_model_id / params_hash.
export const LABELER_VERSION = "det-1";

export interface LabelerConfig {
  top_k_domains: number; // registrable domains named in `scope` before the "+N sites" tail
  max_keyphrases: number; // cap on emitted keyphrases
  min_token_len: number; // drop title tokens shorter than this (in code points)
  stopwords: ReadonlySet<string>; // tokens excluded from keyphrases
}

// Labeler knobs. NOT part of the task-36.7 validation sweep (unlike the DEFAULT_*
// configs in config.ts, which tune clustering geometry) — the labeler only
// affects the human-readable label, never cluster membership — so it lives with
// its only consumer rather than in config.ts.
export const DEFAULT_LABELER_CONFIG: LabelerConfig = {
  top_k_domains: 1,
  max_keyphrases: 5,
  min_token_len: 3,
  stopwords: new Set<string>([
    "the", "and", "for", "with", "from", "that", "this", "you", "your",
    "are", "was", "were", "but", "not", "have", "has", "had", "can",
    "will", "would", "could", "should", "all", "any", "how", "what",
    "when", "where", "who", "why", "into", "out", "about", "over",
    "new", "get", "use", "using", "via",
  ]),
};

// NFC then locale-independent lowercasing; the two are not commutative for a few
// code points, so the order is pinned (NFC first, matching page_vectors.ts).
function normalize_for_tokens(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

// Split on any run of non-(letter/number); drop the empty edges. Unicode-aware.
function tokenize(s: string): string[] {
  return normalize_for_tokens(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== "");
}

// Code-point length (surrogate-safe), not UTF-16 .length — mirrors the
// code-point discipline in page_vectors.ts so a surrogate-pair token counts as
// one character.
function code_point_len(s: string): number {
  return Array.from(s).length;
}

// Lexicographic code-unit comparison — locale-free and byte-stable across hosts,
// unlike String.prototype.localeCompare.
function code_unit_compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Rank entries by (count desc, key asc) and return the keys. The shared
// deterministic order behind both keyphrases and the domain distribution.
function ranked_keys(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || code_unit_compare(a[0], b[0]))
    .map((e) => e[0]);
}

// scope: the registrable-domain distribution of the member pages. Domain is the
// always-present signal (parsed from url); site_name is unreliable <head>
// metadata and deliberately unused. Names the top-k domains, then summarizes the
// rest as "+N sites"; "" when no member URL parses to a registrable domain.
function build_scope(
  member_indices: number[],
  visits: VisitRow[],
  config: LabelerConfig,
): string {
  const counts = new Map<string, number>();
  for (const i of member_indices) {
    const domain = getDomain(visits[i].url);
    if (domain === null || domain === "") continue; // IPs, localhost, about:, malformed
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  if (counts.size === 0) return "";

  const ranked = ranked_keys(counts);
  const named = ranked.slice(0, config.top_k_domains);
  const remaining = ranked.length - named.length;
  let scope = named.join(", ");
  if (remaining > 0) scope += ` +${remaining} site${remaining === 1 ? "" : "s"}`;
  return scope;
}

// keyphrases: term frequency over the member titles (the cluster's OWN titles —
// no IDF, no window corpus, so the same project yields the same keyphrases
// regardless of its window neighbors; this is the deliberate non-c-TF-IDF
// choice). Duplicate titles legitimately count twice (dedupe_visits already
// collapsed same-URL-same-tree reloads, so repeats are genuine signal).
function build_keyphrases(
  member_indices: number[],
  visits: VisitRow[],
  config: LabelerConfig,
): string[] {
  const counts = new Map<string, number>();
  for (const i of member_indices) {
    const title = visits[i].title;
    if (title === null) continue;
    for (const token of tokenize(title)) {
      if (config.stopwords.has(token)) continue;
      if (code_point_len(token) < config.min_token_len) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return ranked_keys(counts).slice(0, config.max_keyphrases);
}

/**
 * Compose the human-readable display string from the label parts (plan §7,
 * AC#3 recomposition). Pure and total: the UI and tests call it to recompose
 * `display_label` from the stored fields without re-running label_cluster, so
 * `display_label` is never a separately-baked string. Two rules, total over
 * every empty-input combination:
 *   1. title_part = headline_title, else the joined keyphrases, else "".
 *   2. result = "<title_part> — <scope>" when both are non-empty; otherwise
 *      whichever of the two is non-empty; otherwise the "Untitled cluster"
 *      placeholder. (scope is an appendix to the title part, not a peer rung.)
 */
export function compose_display_label(
  headline_title: string,
  scope: string,
  keyphrases: string[],
): string {
  const title_part =
    headline_title !== ""
      ? headline_title
      : keyphrases.length > 0
        ? keyphrases.join(", ")
        : "";

  if (title_part !== "" && scope !== "") return `${title_part} — ${scope}`;
  if (title_part !== "") return title_part;
  if (scope !== "") return scope;
  return "Untitled cluster";
}

/**
 * Build the deterministic ClusterLabel for one represented cluster (plan §7).
 * `headline_title` is the representative page's title; `scope` the
 * registrable-domain distribution; `keyphrases` the title term-frequency terms;
 * `display_label` the composition of those parts; `representation_version` the
 * labeler version.
 *
 * @param cluster the represented cluster; representative_index selects the
 *   representative VisitRow (the eom exemplar, or the medoid fallback that
 *   represent_clusters resolved), member_indices the pages mined for
 *   scope/keyphrases.
 * @param visits  the window's deduped VisitRows (dedupe_visits output),
 *   index-aligned to the cluster's indices — repeat same-URL visits are already
 *   collapsed, so a duplicate title is genuine keyphrase signal.
 * @param config  labeler knobs; defaults to DEFAULT_LABELER_CONFIG.
 */
export function label_cluster(
  cluster: RepresentedCluster,
  visits: VisitRow[],
  config: LabelerConfig = DEFAULT_LABELER_CONFIG,
): ClusterLabel {
  const representative_title = visits[cluster.representative_index].title;
  const headline_title = representative_title === null ? "" : representative_title.trim();

  const scope = build_scope(cluster.member_indices, visits, config);
  const keyphrases = build_keyphrases(cluster.member_indices, visits, config);
  const display_label = compose_display_label(headline_title, scope, keyphrases);

  return {
    headline_title,
    scope,
    keyphrases,
    display_label,
    representation_version: LABELER_VERSION,
  };
}
