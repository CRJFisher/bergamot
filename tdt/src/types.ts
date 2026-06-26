// Leaf module: imports nothing. ports.ts depends on these types, never the reverse.

export interface VisitRow {
  page_session_id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  page_loaded_at: string; // ISO-8601 TEXT
  tree_id: string;
}

// The page-representation strategy used to build a page vector (plan §4).
// Folded (as a version suffix) into embedding_model_id so a representation
// change is a clean cache invalidation.
export type PageRepr = "title_plus_lead" | "main_content_extract";

// One re-downloaded public page's extracted content, projected from vscode's
// CorpusContent (the task-39.2 read path). TDT consumes this; it never
// re-downloads, never parses HTML, and never re-classifies fetch outcomes —
// auth/paywall/dead/non-HTML pages are excluded upstream and never appear here.
// title is "" (never null) when the page has none; the no-text guard handles it.
//
// The extension's TDT adapter (a later orchestration subtask) maps each `ok`
// CorpusContent → PageContent, keeping page_session_id/title/content and dropping
// the fetch-fidelity metadata TDT does not embed. TDT defines this minimal shape
// so the pure library need not import vscode types.
export interface PageContent {
  page_session_id: string;
  title: string;
  content: string; // already-extracted main-content markdown
}

export interface PageVector {
  page_session_id: string;
  vector: Float32Array; // L2-normalized page vector
  low_confidence: boolean; // multi-topic dispersion / fell back to dominant segment
}

// Dense (n,n) cosine-distance matrix. D[i][i]=0, symmetric, values in [0, 2].
export type DistanceMatrix = number[][];

export interface HdbscanRaw {
  labels: number[]; // -1 = noise
  probabilities: number[]; // [0,1], 0 for noise
  exemplar_indices: Map<number, number>; // clusterId -> single row index (eom + storeExemplars)
}

export interface RepresentedCluster {
  local_label: number;
  member_indices: number[];
  representative_index: number; // exemplar (eom) else medoid
  representative_vector: Float32Array; // FROZEN: L2-normalized mean of member vectors
  size: number;
  time_span: { start: string; end: string };
}

// The deterministic labeler's output for one cluster (plan §7). Stored as
// SEPARATE fields — never one baked string — so the UI can recompose the display
// string and a later LLM can consume the bundle. Every field is CONCRETE
// (non-null): the labeler always produces a value (headline_title is "" only
// when the exemplar page itself has no title). The persistence shape
// (ClusterRecord, below) keeps the mirrored columns nullable to match the §8
// DDL; the persist step (TASK-36.6) maps RepresentedCluster + ClusterLabel ->
// ClusterRecord, widening non-null to nullable. Computed at page granularity
// (the member set is already pages).
export interface ClusterLabel {
  headline_title: string; // representative page's VisitRow.title; "" if it has none
  scope: string; // registrable-domain distribution, e.g. "nextjs.org +3 sites"; "" if no URL parses
  keyphrases: string[]; // cheap deterministic terms mined from member titles; never null
  display_label: string; // composed template over the parts (see compose_display_label)
  representation_version: string; // labeler-logic version; bump when label output changes
}

// Persistence record types (written via ClusterSink, mirroring the §8 DDL).

export interface RunRecord {
  id: string; // sha256 of the normalized natural key
  window_start: string; // ISO, inclusive
  window_end: string; // ISO, exclusive (ACTUAL bounds used, incl. subdivision)
  params_hash: string;
  params_json: string;
  embedding_model_id: string; // model + dim + page-representation rule, e.g. 'bge-small-en@384#repr-v1'
  algo_version: string; // 'hdbscan-1#clustering-tfjs@<ver>#<tf-backend>'
  input_count: number;
  input_fingerprint: string; // hash of sorted (page_session_id, embedding_vector_version)
  cluster_count: number | null; // null while status='running'
  noise_count: number | null;  // null while status='running'
  status: "running" | "complete" | "failed" | "superseded";
  created_at: string;
  completed_at: string | null;
}

export interface ClusterRecord {
  id: string; // hash(run_id | local_label)
  run_id: string;
  local_label: number; // HDBSCAN labels_ value (>= 0), run-local
  size: number;
  exemplar_page_session_id: string;
  representative_vector: Float32Array; // FROZEN; L2-normalized mean of member vectors
  coherence: number | null;
  time_span_start: string;
  time_span_end: string;
  headline_title: string | null;
  scope: string | null;
  keyphrases: string[];
  display_label: string | null;
  representation_version: string | null;
  lifeline_id: string | null; // NULL in v1; Phase-4 tracking seam
}

export interface MemberRecord {
  run_id: string;
  page_session_id: string;
  cluster_id: string | null; // set iff !is_noise
  is_noise: boolean; // true => HDBSCAN -1
  probability: number; // [0,1]; 0 for noise
  page_loaded_at: string; // denormalized for time filtering
  is_exemplar: boolean;
}
