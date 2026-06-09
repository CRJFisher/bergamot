/**
 * Capture-first storage: persist the raw page losslessly (zstd-compressed)
 * alongside cheap `<head>` metadata. Page content is read back by re-downloading
 * the public URL in post-processing (the re-download corpus, task-39.2), not from
 * this store.
 */

import { compress } from "@mongodb-js/zstd";
import { DuckDB, insert_webpage_capture } from "../duck_db";
import { PageCapture } from "../page_capture_models";
import { read_metadata } from "./read_metadata";

/** Codec marker stored alongside the compressed page bytes. */
export const CAPTURE_ENCODING = "zstd";

export interface StoreCaptureInput {
  page_session_id: string;
  url: string;
  /** The raw captured page (decompressed HTML). */
  html: string;
  /** MIME type of the captured page. */
  content_type: string;
  /** ISO timestamp when the page was captured. */
  captured_at: string;
}

/**
 * Compresses the raw page, reads cheap `<head>` metadata, and stores both in
 * {@link DuckDB} keyed by `page_session_id`. Returns the stored metadata view.
 */
export async function store_capture(
  db: DuckDB,
  input: StoreCaptureInput
): Promise<PageCapture> {
  const raw = Buffer.from(input.html, "utf-8");
  const compressed = await compress(raw);
  const metadata = read_metadata(input.html, input.url);

  const record = {
    page_session_id: input.page_session_id,
    content_compressed: new Uint8Array(compressed),
    content_encoding: CAPTURE_ENCODING,
    original_byte_size: raw.length,
    content_type: input.content_type,
    url: input.url,
    title: metadata.title,
    site_name: metadata.site_name,
    author: metadata.author,
    published_at: metadata.published_at,
    lang: metadata.lang,
    captured_at: input.captured_at,
  };
  await insert_webpage_capture(db, record);

  return {
    page_session_id: record.page_session_id,
    original_byte_size: record.original_byte_size,
    content_type: record.content_type,
    url: record.url,
    title: record.title,
    site_name: record.site_name,
    author: record.author,
    published_at: record.published_at,
    lang: record.lang,
    captured_at: record.captured_at,
  };
}
