import { z } from "zod";
import { PageActivitySessionSchema } from "./duck_db_models";

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

export const PageActivitySessionWithMetaSchema =
  PageActivitySessionSchema.extend({
    capture: PageCaptureSchema.optional()
      .nullable()
      .describe("The page's capture record (metadata only; raw bytes on demand)"),
  });

export type PageActivitySessionWithMeta = z.infer<
  typeof PageActivitySessionWithMetaSchema
>;
