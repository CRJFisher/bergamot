import { DuckDB } from "./connection";
import {
  WEBPAGE_TREES_TABLE,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  TOPIC_PAGE_VECTOR_TABLE,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  TOPIC_CLUSTER_CONTROL_TABLE,
} from "./table_names";

/**
 * Creates the metadata-store tables and indexes (idempotent). Called once
 * after {@link DuckDB.init} by the owner of the metadata store; the content
 * cache (a separate encrypted store) has its own schema.
 */
export async function create_metadata_schema(db: DuckDB): Promise<void> {
  await db.create_table(
    WEBPAGE_TREES_TABLE,
    [
      "id TEXT PRIMARY KEY",
      "latest_activity_time TEXT",
      "first_load_time TEXT",
    ].join(", ")
  );

  await db.create_table(
    WEBPAGE_ACTIVITY_SESSIONS_TABLE,
    [
      "id TEXT PRIMARY KEY",
      "url TEXT NOT NULL",
      "referrer TEXT",
      "referrer_page_session_id TEXT",
      "page_loaded_at TEXT",
      `tree_id TEXT NOT NULL REFERENCES ${WEBPAGE_TREES_TABLE}(id)`,
    ].join(", ")
  );

  // Capture metadata store, keyed by page_session_id (no foreign key, so a
  // capture can be written before or independently of the activity-session row).
  // Holds browsing metadata only — page content is never stored here.
  await db.create_table(
    WEBPAGE_CAPTURE_TABLE,
    [
      "page_session_id TEXT PRIMARY KEY",
      "url TEXT NOT NULL",
      "title TEXT NOT NULL",
      "content_type TEXT NOT NULL",
      "captured_at TEXT NOT NULL",
    ].join(", ")
  );

  // Re-download fidelity log: one row per post-processing fetch of a stored
  // URL. Append-only so content drift and unavailability stay visible over
  // time. Holds NO page content.
  await db.create_table(
    WEBPAGE_FETCH_TABLE,
    [
      "fetch_id TEXT PRIMARY KEY",
      "page_session_id TEXT NOT NULL",
      "url TEXT NOT NULL",
      "final_url TEXT",
      "outcome TEXT NOT NULL",
      "http_status INTEGER",
      "content_hash TEXT",
      "content_type TEXT",
      "author TEXT",
      "published_at TEXT",
      "lang TEXT",
      "site_name TEXT",
      "fetched_at TEXT NOT NULL",
    ].join(", ")
  );

  // TDT-owned page-vector cache (TASK-36.3.1): one L2-normalized embedding per
  // (page, model). The cache key folds the representation-rule version into
  // embedding_model_id, so a model or representation change is a clean miss.
  await db.create_table(
    TOPIC_PAGE_VECTOR_TABLE,
    [
      "page_session_id TEXT NOT NULL",
      "embedding_model_id TEXT NOT NULL",
      "vector FLOAT[] NOT NULL",
      "repr TEXT NOT NULL",
      "built_at TEXT NOT NULL",
      "PRIMARY KEY (page_session_id, embedding_model_id)",
    ].join(", ")
  );

  // TDT clustering output (TASK-36.6). Cross-table references are SOFT refs
  // (plain TEXT, no FOREIGN KEY): DuckDB rejects ON DELETE CASCADE and cannot
  // delete a FK parent and child in one transaction, which would make the
  // atomic-replace path (delete members→clusters→run, repopulate) impossible.

  // A clustering RUN over one window. `id` is sha256 of the natural key;
  // UNIQUE over the natural key is a redundant corruption guard.
  await db.create_table(
    TOPIC_RUN_TABLE,
    [
      "id TEXT PRIMARY KEY",
      "window_start TEXT NOT NULL",
      "window_end TEXT NOT NULL",
      "params_hash TEXT NOT NULL",
      "params_json TEXT NOT NULL",
      "embedding_model_id TEXT NOT NULL",
      "algo_version TEXT NOT NULL",
      "input_count INTEGER NOT NULL",
      "input_fingerprint TEXT NOT NULL",
      "cluster_count INTEGER",
      "noise_count INTEGER",
      "status TEXT NOT NULL",
      "created_at TEXT NOT NULL",
      "completed_at TEXT",
      "UNIQUE (window_start, window_end, params_hash, embedding_model_id, algo_version)",
    ].join(", ")
  );

  // One row per CLUSTER (HDBSCAN label >= 0). Noise (-1) is a member row with
  // is_noise=TRUE, not a cluster row.
  await db.create_table(
    TOPIC_CLUSTER_TABLE,
    [
      "id TEXT PRIMARY KEY",
      "run_id TEXT NOT NULL",
      "local_label INTEGER NOT NULL",
      "size INTEGER NOT NULL",
      "exemplar_page_session_id TEXT NOT NULL",
      "representative_vector FLOAT[] NOT NULL",
      "coherence DOUBLE",
      "time_span_start TEXT NOT NULL",
      "time_span_end TEXT NOT NULL",
      "headline_title TEXT",
      "scope TEXT",
      "keyphrases TEXT[]",
      "display_label TEXT",
      "representation_version TEXT",
      "lifeline_id TEXT",
      "UNIQUE (run_id, local_label)",
    ].join(", ")
  );

  // One row per (run, page). PK enforces one cluster per page per run.
  await db.create_table(
    TOPIC_CLUSTER_MEMBER_TABLE,
    [
      "run_id TEXT NOT NULL",
      "page_session_id TEXT NOT NULL",
      "cluster_id TEXT",
      "is_noise BOOLEAN NOT NULL DEFAULT FALSE",
      "probability DOUBLE NOT NULL",
      "page_loaded_at TEXT NOT NULL",
      "is_exemplar BOOLEAN NOT NULL DEFAULT FALSE",
      "PRIMARY KEY (run_id, page_session_id)",
    ].join(", ")
  );

  // User curation over clusters (TASK-36.8). `id` is a deterministic hash of
  // (kind | target) so an upsert is idempotent.
  await db.create_table(
    TOPIC_CLUSTER_CONTROL_TABLE,
    [
      "id TEXT PRIMARY KEY",
      "kind TEXT NOT NULL",
      "target_page_session_id TEXT",
      "content_signature TEXT",
      "target_origin TEXT",
      "display_label_override TEXT",
      "created_at TEXT NOT NULL",
      "updated_at TEXT NOT NULL",
    ].join(", ")
  );

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_url
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(url)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_tree_id
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(tree_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_referrer
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(referrer_page_session_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_sessions_loaded_at
                 ON ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}(page_loaded_at)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_trees_latest_activity
                 ON ${WEBPAGE_TREES_TABLE}(latest_activity_time)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_capture_title
                 ON ${WEBPAGE_CAPTURE_TABLE}(title)`);
  // The right-to-forget cascade deletes page vectors by page_session_id.
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_page_vector_page
                 ON ${TOPIC_PAGE_VECTOR_TABLE}(page_session_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_run_window
                 ON ${TOPIC_RUN_TABLE}(window_start, window_end)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_run_status
                 ON ${TOPIC_RUN_TABLE}(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_cluster_run
                 ON ${TOPIC_CLUSTER_TABLE}(run_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_member_cluster
                 ON ${TOPIC_CLUSTER_MEMBER_TABLE}(cluster_id)`);
  // Both the right-to-forget cascade and list_clusters_for_page (TASK-36.8)
  // read members by page_session_id.
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_member_page
                 ON ${TOPIC_CLUSTER_MEMBER_TABLE}(page_session_id)`);
  // Cluster controls: resolve_controls reads by kind; the forget cascade sweeps
  // suppress/rename by target_page_session_id.
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_cluster_control_kind
                 ON ${TOPIC_CLUSTER_CONTROL_TABLE}(kind)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_cluster_control_page
                 ON ${TOPIC_CLUSTER_CONTROL_TABLE}(target_page_session_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_cluster_control_origin
                 ON ${TOPIC_CLUSTER_CONTROL_TABLE}(target_origin)`);
}
