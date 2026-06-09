/**
 * Metadata-only capture storage: persist a visit's browsing metadata (url,
 * title, content type, capture timestamp) keyed by `page_session_id`. Page
 * content is never read or stored at capture; it is obtained later by
 * re-downloading the public URL (the re-download corpus, task-39.2).
 */

import { DuckDB, insert_webpage_capture } from "../duck_db";
import { PageCapture } from "../page_capture_models";

export interface StoreCaptureInput {
  page_session_id: string;
  url: string;
  /** Page title, captured from the browser tab. */
  title: string;
  /** MIME type of the captured page. */
  content_type: string;
  /** ISO timestamp when the page was captured. */
  captured_at: string;
}

/**
 * Stores a visit's browsing metadata in {@link DuckDB} keyed by
 * `page_session_id`. Returns the stored metadata record.
 */
export async function store_capture(
  db: DuckDB,
  input: StoreCaptureInput
): Promise<PageCapture> {
  const record: PageCapture = {
    page_session_id: input.page_session_id,
    url: input.url,
    title: input.title,
    content_type: input.content_type,
    captured_at: input.captured_at,
  };
  await insert_webpage_capture(db, record);
  return record;
}
