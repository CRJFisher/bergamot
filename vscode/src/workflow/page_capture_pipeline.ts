import { DuckDB } from "../duck_db";
import { PageActivitySession } from "../duck_db_models";
import { record_outcome } from "../dev_log";
import { store_capture } from "./store_capture";

/**
 * Immutable dependencies for the capture pipeline. A plain struct, not a
 * stateful class — the pipeline is a function, not an object.
 */
export interface CaptureDeps {
  duck_db: DuckDB;
}

export interface CaptureInputs {
  new_page: PageActivitySession;
  /** Page title, captured from the browser tab. */
  title: string;
  visit_id?: string;
}

/**
 * The capture pipeline. For each visit it stores the browsing metadata (url,
 * title, capture timestamp) via `store_capture` in DuckDB. No page content is
 * read or stored — content is obtained on demand by re-downloading the public
 * URL (the re-download corpus, task-39.2). There is no capture gate: empty /
 * auth / redirect pages cannot be judged here (no content to inspect), so that
 * exclusion now happens at re-download time — see `redownload/fetch_outcome.ts`
 * (auth_redirect / dead_link) and `redownload/corpus.ts`. Tree linking happens
 * upstream in the visit queue (`webpage_tree`) before this runs.
 */
export async function run_page_capture(
  deps: CaptureDeps,
  inputs: CaptureInputs
): Promise<void> {
  const visit_id = inputs.visit_id ?? inputs.new_page.id;

  // Any failure propagates to the visit queue, which records the terminal
  // `failed` outcome and decides whether to retry.
  await store_capture(deps.duck_db, {
    page_session_id: inputs.new_page.id,
    url: inputs.new_page.url,
    title: inputs.title,
    content_type: "text/html",
    captured_at: new Date().toISOString(),
  });

  record_outcome({
    visit_id,
    url: inputs.new_page.url,
    decision: "stored",
  });
}
