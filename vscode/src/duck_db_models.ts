import { z } from "zod";

/**
 * Complete page activity session schema including all fields.
 * Represents a single webpage visit with full metadata and content.
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
  /** The extracted and processed text content of the webpage */
  content: z.string().describe("The extracted text content of the webpage"),
  /** ISO timestamp when the page was loaded in the browser */
  page_loaded_at: z
    .string()
    .describe("ISO timestamp string when the page was loaded"),
});
/**
 * Page activity session schema without content field.
 * Used when content is stored separately (e.g., in LanceDB) to reduce data transfer.
 */
export const PageActivitySessionWithoutContentSchema =
  PageActivitySessionSchema.omit({
    content: true,
  });

/**
 * Page activity session schema for initial processing before tree assignment.
 * Excludes both content and tree_id fields, used during the tree management phase.
 */
export const PageActivitySessionWithoutTreeOrContentSchema =
  PageActivitySessionWithoutContentSchema.omit({
    tree_id: true,
  }).describe(
    "PageActivitySession schema without tree_id, used for initial page activity tracking"
  );

/**
 * Page activity session without content field.
 * Used when content is managed separately for performance or storage optimization.
 * 
 * @example
 * ```typescript
 * const sessionWithoutContent: PageActivitySessionWithoutContent = {
 *   id: 'session-123',
 *   url: 'https://example.com',
 *   referrer: 'https://google.com',
 *   tree_id: 'tree-456',
 *   page_loaded_at: '2024-01-01T12:00:00Z'
 * };
 * ```
 */
export type PageActivitySessionWithoutContent = z.infer<
  typeof PageActivitySessionWithoutContentSchema
>;

/**
 * Page activity session for initial processing phase.
 * Missing tree assignment and content, used during webpage visit ingestion.
 * 
 * @example
 * ```typescript
 * const newVisit: PageActivitySessionWithoutTreeOrContent = {
 *   id: 'session-123',
 *   url: 'https://example.com/article',
 *   referrer: 'https://news.site.com',
 *   page_loaded_at: '2024-01-01T12:00:00Z'
 *   // tree_id will be assigned during processing
 * };
 * ```
 */
export type PageActivitySessionWithoutTreeOrContent = z.infer<
  typeof PageActivitySessionWithoutTreeOrContentSchema
>;

/**
 * Complete page activity session with all fields.
 * Represents a fully processed webpage visit including content and tree assignment.
 * 
 * @example
 * ```typescript
 * const fullSession: PageActivitySession = {
 *   id: 'session-123',
 *   url: 'https://example.com/article',
 *   referrer: 'https://news.site.com',
 *   referrer_page_session_id: 'session-122',
 *   tree_id: 'tree-456',
 *   content: 'Article content here...',
 *   page_loaded_at: '2024-01-01T12:00:00Z'
 * };
 * ```
 */
export type PageActivitySession = z.infer<typeof PageActivitySessionSchema>;
