import { z } from "zod";

export const PageActivitySessionSchema = z.object({
  id: z.string().describe("Unique identifier for the page (for references)"),
  // Basic page information
  url: z.string().describe("The URL of the webpage"),
  referrer: z
    .string()
    .nullable()
    .describe("The referrer URL that led to this page"),
  referrer_page_session_id: z
    .string()
    .optional()
    .nullable()
    .describe(
      "The ID of the page session that referred to this page, if this isn't a root page"
    ),
  tree_id: z
    .string()
    .describe("The ID of the navigation tree this page belongs to"),
  content: z.string().describe("The extracted text content of the webpage"),
  page_loaded_at: z
    .string()
    .describe("ISO timestamp string when the page was loaded"),
});
export const PageActivitySessionWithoutContentSchema =
  PageActivitySessionSchema.omit({
    content: true,
  });

export const PageActivitySessionWithoutTreeOrContentSchema =
  PageActivitySessionWithoutContentSchema.omit({
    tree_id: true,
  }).describe(
    "PageActivitySession schema without tree_id, used for initial page activity tracking"
  );

export type PageActivitySessionWithoutContent = z.infer<
  typeof PageActivitySessionWithoutContentSchema
>;

export type PageActivitySessionWithoutTreeOrContent = z.infer<
  typeof PageActivitySessionWithoutTreeOrContentSchema
>;

export type PageActivitySession = z.infer<typeof PageActivitySessionSchema>;
