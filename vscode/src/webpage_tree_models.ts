import { z } from "zod";
import { PageActivitySessionWithMetaSchema } from "./reconcile_webpage_trees_workflow_models";

export const WebpageTreeNodeSchema = z.object({
  webpage_session: PageActivitySessionWithMetaSchema,
  children: z.array(z.lazy(() => WebpageTreeNodeSchema)).optional(),
});
export type WebpageTreeNode = z.infer<typeof WebpageTreeNodeSchema>;
