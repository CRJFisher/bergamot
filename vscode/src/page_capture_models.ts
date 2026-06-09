import { z } from "zod";
import { PageActivitySessionSchema } from "./duck_db_models";
import { FETCH_OUTCOME_KINDS } from "./redownload/fetch_outcome";

/**
 * The canonical per-page record: cheap metadata read from the page's
 * <head> alongside the stored raw page. The compressed bytes live in DuckDB
 * `webpage_capture`; this is the metadata view read for navigation/listing
 * without decompression.
 */
export const PageCaptureSchema = z.object({
  page_session_id: z.string().describe("The page session this capture belongs to"),
  url: z.string().describe("The captured page URL"),
  title: z.string().describe("Page title from the cheap <head> metadata"),
  site_name: z.string().nullable().optional().describe("og:site_name, if present"),
  author: z.string().nullable().optional().describe("Author meta, if present"),
  published_at: z
    .string()
    .nullable()
    .optional()
    .describe("Publication timestamp meta, if present"),
  lang: z.string().nullable().optional().describe("Document language, if present"),
  content_type: z.string().describe("MIME type of the captured page"),
  captured_at: z.string().describe("ISO timestamp when the page was captured"),
  original_byte_size: z.number().describe("Decompressed page size in bytes"),
});
export type PageCapture = z.infer<typeof PageCaptureSchema>;

/**
 * One re-download attempt: the fetch-outcome classification plus the fidelity
 * metadata (`fetched_at`, `http_status`, `content_hash`) and the `<meta>`-derived
 * fields parsed from the re-downloaded page. Appended once per fetch so that
 * content drift and unavailability over time stay visible. Holds no page content
 * — re-downloaded bytes are returned on demand by the read path, and an encrypted
 * on-demand cache is a separate tier (task-39.3).
 */
export const WebpageFetchSchema = z.object({
  page_session_id: z.string().describe("The stored metadata row this fetch serves"),
  url: z.string().describe("The stored public URL that was re-downloaded"),
  final_url: z
    .string()
    .nullable()
    .describe("URL after redirects; null if the request never resolved"),
  outcome: z
    .enum(FETCH_OUTCOME_KINDS)
    .describe("Classification; only 'ok' enters the public corpus"),
  http_status: z
    .number()
    .int()
    .nullable()
    .describe("Final HTTP status; null on transport failure"),
  content_hash: z
    .string()
    .nullable()
    .describe("SHA-256 hex of re-downloaded content; null when excluded"),
  content_type: z.string().nullable().describe("MIME of the re-downloaded response"),
  author: z.string().nullable().describe("author meta parsed from the re-download"),
  published_at: z
    .string()
    .nullable()
    .describe("publication timestamp meta from the re-download"),
  lang: z.string().nullable().describe("document language from the re-download"),
  site_name: z.string().nullable().describe("og:site_name from the re-download"),
  fetched_at: z.string().describe("ISO timestamp of the fetch attempt"),
});
export type WebpageFetch = z.infer<typeof WebpageFetchSchema>;

export const PageActivitySessionWithMetaSchema =
  PageActivitySessionSchema.extend({
    capture: PageCaptureSchema.optional()
      .nullable()
      .describe("The page's capture record (metadata only; raw bytes on demand)"),
  });

export type PageActivitySessionWithMeta = z.infer<
  typeof PageActivitySessionWithMetaSchema
>;
