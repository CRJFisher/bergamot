import { z } from "zod";

/**
 * Complete page activity session schema. Represents a single webpage visit as
 * browsing metadata only — page content is never part of a session (it is
 * obtained on demand by re-downloading the public URL).
 */
export const PageActivitySessionSchema = z.object({
  /** Unique identifier for the page session (used for references) */
  id: z.string().describe("Unique identifier for the page (for references)"),
  // Basic page information
  /** The full URL of the visited webpage */
  url: z.string().describe("The URL of the webpage"),
  /** The referrer URL that led to this page (null for direct navigation) */
  referrer: z
    .string()
    .nullable()
    .describe("The referrer URL that led to this page"),
  /** ID of the parent page session that opened this page (for tree structure) */
  referrer_page_session_id: z
    .string()
    .optional()
    .nullable()
    .describe(
      "The ID of the page session that referred to this page, if this isn't a root page"
    ),
  /** ID of the navigation tree this page belongs to */
  tree_id: z
    .string()
    .describe("The ID of the navigation tree this page belongs to"),
  /** ISO timestamp when the page was loaded in the browser */
  page_loaded_at: z
    .string()
    .describe("ISO timestamp string when the page was loaded"),
});

/**
 * Page activity session before tree assignment — the shape ingested from the
 * browser, missing only the `tree_id` that the tree-management phase assigns.
 */
export const PageActivitySessionWithoutTreeSchema =
  PageActivitySessionSchema.omit({
    tree_id: true,
  }).describe(
    "PageActivitySession schema without tree_id, used for initial page activity tracking"
  );

/**
 * Page activity session for the initial ingestion phase, before a navigation
 * tree is assigned.
 *
 * @example
 * ```typescript
 * const newVisit: PageActivitySessionWithoutTree = {
 *   id: 'session-123',
 *   url: 'https://example.com/article',
 *   referrer: 'https://news.site.com',
 *   page_loaded_at: '2024-01-01T12:00:00Z'
 *   // tree_id will be assigned during processing
 * };
 * ```
 */
export type PageActivitySessionWithoutTree = z.infer<
  typeof PageActivitySessionWithoutTreeSchema
>;

/**
 * Complete page activity session with tree assignment.
 *
 * @example
 * ```typescript
 * const fullSession: PageActivitySession = {
 *   id: 'session-123',
 *   url: 'https://example.com/article',
 *   referrer: 'https://news.site.com',
 *   referrer_page_session_id: 'session-122',
 *   tree_id: 'tree-456',
 *   page_loaded_at: '2024-01-01T12:00:00Z'
 * };
 * ```
 */
export type PageActivitySession = z.infer<typeof PageActivitySessionSchema>;
