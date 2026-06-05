/**
 * Capture-first storage: persist the raw page losslessly (zstd-compressed) as
 * the durable source of truth, alongside cheap `<head>` metadata. Interpretation
 * — main-content extraction, chunking, embedding, summarisation — is handled by
 * the RAG-prep pipeline (task-31), which reads the stored raw page on demand via
 * {@link read_capture}.
 */

import { compress, decompress } from "@mongodb-js/zstd";
import {
  DuckDB,
  get_webpage_capture,
  get_webpage_capture_bytes,
  insert_webpage_capture,
} from "../duck_db";
import { PageCapture } from "../page_capture_models";
import { read_metadata } from "./read_metadata";

/** Codec marker stored alongside the compressed page bytes. */
export const CAPTURE_ENCODING = "zstd";

/** The raw HTML and its cheap metadata, recovered from a stored capture. */
export interface RecoveredCapture {
  html: string;
  metadata: PageCapture;
}

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

/**
 * Recovers a stored capture: decompresses the raw page bytes back to the
 * original HTML and returns it with the capture metadata. This is the
 * parent-document read path for the RAG-prep pipeline (task-31.3). Returns null
 * if no capture exists for the id.
 */
export async function read_capture(
  db: DuckDB,
  page_session_id: string
): Promise<RecoveredCapture | null> {
  const [bytes, metadata] = await Promise.all([
    get_webpage_capture_bytes(db, page_session_id),
    get_webpage_capture(db, page_session_id),
  ]);
  if (!bytes || !metadata) return null;
  const html = (await decompress(Buffer.from(bytes))).toString("utf-8");
  return { html, metadata };
}
