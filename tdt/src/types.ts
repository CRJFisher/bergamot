export interface VisitRow {
  page_session_id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  page_loaded_at: string; // ISO-8601
  tree_id: string;
}

// Folded (as a version suffix) into embedding_model_id so a representation
// change is a clean cache invalidation.
export type PageRepr = "title_plus_lead" | "main_content_extract";

// One re-downloaded public page's extracted content. TDT never re-downloads,
// parses HTML, or classifies fetch outcomes — auth/paywall/dead/non-HTML pages
// are excluded upstream and never appear here. title is "" (never null) when the
// page has none. This minimal shape lets the pure library avoid importing vscode
// types.
export interface PageContent {
  page_session_id: string;
  title: string;
  content: string; // already-extracted main-content markdown
}

export interface PageVector {
  page_session_id: string;
  vector: Float32Array; // L2-normalized
  low_confidence: boolean; // multi-topic dispersion / fell back to dominant segment
}

// Dense (n,n) cosine-distance matrix. D[i][i]=0, symmetric, values in [0, 2].
export type DistanceMatrix = number[][];

export interface HdbscanRaw {
  labels: number[]; // -1 = noise
  probabilities: number[]; // [0,1], 0 for noise
  exemplar_indices: Map<number, number>; // clusterId -> single row index
}

export interface RepresentedCluster {
  local_label: number;
  member_indices: number[];
  representative_index: number; // exemplar (eom) else medoid
  representative_vector: Float32Array; // L2-normalized mean of member vectors
  size: number;
  time_span: { start: string; end: string };
}

// Stored as separate fields — never one baked string — so the UI can recompose
// the display string and a later LLM can consume the bundle. Every field is
// non-null: the labeler always produces a value (headline_title is "" only when
// the exemplar page itself has no title).
export interface ClusterLabel {
  headline_title: string; // representative page's title; "" if it has none
  scope: string; // registrable-domain distribution, e.g. "nextjs.org +3 sites"; "" if no URL parses
  keyphrases: string[];
  display_label: string;
  representation_version: string; // bump when label output changes
}

export interface RunRecord {
  id: string; // sha256 of the normalized natural key
  window_start: string; // ISO, inclusive
  window_end: string; // ISO, exclusive (actual bounds used, incl. subdivision)
  params_hash: string;
  params_json: string;
  embedding_model_id: string; // model + dim + page-representation rule, e.g. 'bge-small-en@384#repr-v1'
  algo_version: string; // 'hdbscan-1#clustering-tfjs@<ver>#<tf-backend>'
  input_count: number;
  input_fingerprint: string; // hash of sorted (page_session_id, embedding_vector_version)
  cluster_count: number | null; // null while status='running'
  noise_count: number | null; // null while status='running'
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
  representative_vector: Float32Array; // L2-normalized mean of member vectors
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

// `run.id` is the natural-key hash, so the sink looks a prior run up by it
// without re-deriving the key.
export interface RunBundle {
  run: RunRecord;
  clusters: ClusterRecord[];
  members: MemberRecord[]; // one row per input page — clustered AND noise
}

// - noop:     a complete run with this id and an unchanged input_fingerprint
//             already exists — nothing was written.
// - replaced: the same run id existed with a different input_fingerprint
//             (re-embedding or a late-arriving visit) — its clusters/members
//             were atomically replaced.
// - created:  no run with this id existed — it was inserted. Any prior live run
//             for the same window was marked superseded in the same transaction.
export type PersistOutcome = "noop" | "replaced" | "created";

export interface PersistResult {
  run_id: string;
  outcome: PersistOutcome;
  // Runs flipped to 'superseded' by this persist. Empty for noop/replaced.
  superseded_run_ids: string[];
}
