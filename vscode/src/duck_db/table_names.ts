// Table names are exported (rather than kept private behind the package's
// domain functions) so the right-to-forget cascade in right_to_forget.ts can
// enumerate every page-anchored table from a single auditable module.
export const WEBPAGE_ACTIVITY_SESSIONS_TABLE = "webpage_activity_sessions";
export const WEBPAGE_TREES_TABLE = "webpage_trees";
export const WEBPAGE_CAPTURE_TABLE = "webpage_capture";
export const WEBPAGE_FETCH_TABLE = "webpage_fetch";
// Kept in the metadata store so the extension's single writer owns it.
export const TOPIC_PAGE_VECTOR_TABLE = "topic_page_vector";
export const TOPIC_RUN_TABLE = "topic_run";
export const TOPIC_CLUSTER_TABLE = "topic_cluster";
export const TOPIC_CLUSTER_MEMBER_TABLE = "topic_cluster_member";
export const TOPIC_CLUSTER_CONTROL_TABLE = "topic_cluster_control";
