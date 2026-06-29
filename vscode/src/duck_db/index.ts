export { DuckDB, sql_string_literal } from "./connection";
export type { DuckDBConfig } from "./connection";
export {
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_TREES_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  TOPIC_PAGE_VECTOR_TABLE,
  TOPIC_RUN_TABLE,
  TOPIC_CLUSTER_TABLE,
  TOPIC_CLUSTER_MEMBER_TABLE,
  TOPIC_CLUSTER_CONTROL_TABLE,
} from "./table_names";
export { create_metadata_schema } from "./schema";
export {
  insert_webpage_capture,
  get_webpage_capture,
  list_capture_targets,
  get_page_by_title,
  get_webpage_by_url,
  insert_webpage_fetch,
  get_latest_webpage_fetch,
} from "./capture";
export {
  insert_page_activity_session,
  insert_webpage_tree,
  update_webpage_tree_activity_time,
} from "./session_writes";
export {
  find_tree_containing_url,
  get_page_sessions_with_tree_id,
  get_last_modified_trees_with_members,
} from "./session_reads";
