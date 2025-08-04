import { z } from "zod";
import { PageActivitySessionSchema } from "./duck_db_models";

export const PageAnalysisSchema = z.object({
  page_sesssion_id: z
    .string()
    .describe("The ID of the page session being analysed"),
  title: z.string().describe("A concise title for the webpage"),
  summary: z.string().describe("A concise summary of the webpage's content"),
  intentions: z
    .array(z.string())
    .describe(
      "A list of possible intentions or purposes for viewing this webpage"
    ),
});
export type PageAnalysis = z.infer<typeof PageAnalysisSchema>;

export const PageAnalysisSchemaWithoutPageSessionId = PageAnalysisSchema.omit(
  {
    page_sesssion_id: true,
  }
);
export type PageAnalysisWithoutPageSessionId = z.infer<
  typeof PageAnalysisSchemaWithoutPageSessionId
>;

export const PageActivitySessionWithMetaSchema =
  PageActivitySessionSchema.extend({
    analysis: PageAnalysisSchema.optional().nullable().describe(
      "Optional analysis of the page content, summarizing its purpose and intentions"
    ),
    tree_intentions: z
      .array(z.string())
      .optional()
      .nullable()
      .describe(
        "List of intentions derived from the page contents and the tree context"
      ),
  });

  export type PageActivitySessionWithMeta = z.infer<
    typeof PageActivitySessionWithMetaSchema
  >;

  export const TreeIntentionsSchema = z.object({
    page_id_to_intentions: z
      .record(z.string(), z.array(z.string()))
      .describe(
        "A map of page IDs to their updated intentions. Format like: <page_id>: [<intention1>, <intention2>, ...]"
      ),
  });

  export type TreeIntentions = z.infer<typeof TreeIntentionsSchema>;