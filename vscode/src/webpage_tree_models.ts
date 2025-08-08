import { z } from "zod";
import { PageActivitySessionWithMetaSchema } from "./reconcile_webpage_trees_workflow_models";

/**
 * Represents a hierarchical webpage navigation tree node.
 * Each node contains a webpage session and optionally references child pages that were opened from it.
 */
export interface WebpageTreeNode {
  webpage_session: z.infer<typeof PageActivitySessionWithMetaSchema>;
  children?: WebpageTreeNode[];
}

/**
 * Schema for a hierarchical webpage tree node structure.
 * Represents a single page visit within a navigation tree, including all child pages opened from it.
 */
export const WebpageTreeNodeSchema: z.ZodSchema<WebpageTreeNode> = z.object({
  /** The webpage session data including analysis and content metadata */
  webpage_session: PageActivitySessionWithMetaSchema,
  /** Optional array of child nodes representing pages opened from this page */
  children: z.array(z.lazy(() => WebpageTreeNodeSchema)).optional(),
}) as z.ZodSchema<WebpageTreeNode>;

