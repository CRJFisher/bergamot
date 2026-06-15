import { PageActivitySessionWithoutTree } from "./duck_db_models";

export interface ExtendedPageVisit extends PageActivitySessionWithoutTree {
  /** Correlation token threaded through the pipeline for end-to-end tracing */
  visit_id: string;
  /** Page title, captured from the browser tab */
  title: string;
  /** Browser tab ID that opened this page */
  opener_tab_id?: number;
  /** Browser tab ID of this page */
  tab_id?: number;
}

/**
 * Narrows an unknown value — typically JSON deserialized from the durable
 * inbox or the replay ring — to a complete {@link ExtendedPageVisit}.
 *
 * The capture pipeline binds every field to DuckDB, which rejects `undefined`
 * with an opaque `Cannot create values of type ANY` error. A persisted entry
 * written by an earlier capture model can be missing required fields (notably
 * `title`), so callers validate before feeding a visit into the pipeline and
 * drop anything that fails rather than letting it detonate at the DB bind.
 */
export function is_complete_visit(value: unknown): value is ExtendedPageVisit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.url === "string" &&
    typeof v.page_loaded_at === "string" &&
    typeof v.visit_id === "string" &&
    typeof v.title === "string"
  );
}
