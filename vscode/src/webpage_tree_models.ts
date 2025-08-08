import { z } from "zod";
import { PageActivitySessionWithMetaSchema } from "./reconcile_webpage_trees_workflow_models";

/**
 * Schema for a hierarchical webpage tree node structure.
 * Represents a single page visit within a navigation tree, including all child pages opened from it.
 */
export const WebpageTreeNodeSchema = z.object({
  /** The webpage session data including analysis and content metadata */
  webpage_session: PageActivitySessionWithMetaSchema,
  /** Optional array of child nodes representing pages opened from this page */
  children: z.array(z.lazy(() => WebpageTreeNodeSchema)).optional(),
});

/**
 * Represents a hierarchical webpage navigation tree node.
 * Each node contains a webpage session and optionally references child pages that were opened from it.
 * 
 * @interface WebpageTreeNode
 * @example
 * ```typescript
 * const rootNode: WebpageTreeNode = {
 *   webpage_session: {
 *     id: 'session-1',
 *     url: 'https://news.site.com',
 *     analysis: { title: 'News Site', summary: 'Latest news' },
 *     // ... other session data
 *   },
 *   children: [
 *     {
 *       webpage_session: {
 *         id: 'session-2', 
 *         url: 'https://news.site.com/article-1',
 *         referrer_page_session_id: 'session-1'
 *         // ... other session data
 *       }
 *       // No children for this leaf node
 *     }
 *   ]
 * };
 * ```
 */
export type WebpageTreeNode = z.infer<typeof WebpageTreeNodeSchema>;
