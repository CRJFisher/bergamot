// Vanilla TypeScript implementation of the webpage reconciliation workflow
// This replaces the LangChain-based implementation with direct OpenAI SDK usage

import { WebpageWorkflow } from "./workflow/simple_workflow";
import { PageActivitySessionWithoutContent } from "./duck_db_models";
import { DuckDB } from "./duck_db";
import { PageActivitySessionWithMeta } from "./reconcile_webpage_trees_workflow_models";
import { MarkdownDatabase } from "./markdown_db";
import { LanceDBMemoryStore } from "./agent_memory";
import { FilterConfig } from "./workflow/webpage_filter";

export async function run_workflow(
  inputs: {
    members: PageActivitySessionWithMeta[];
    new_page: PageActivitySessionWithoutContent;
    raw_content: string;
  },
  app: any, // Legacy parameter for compatibility
  duck_db: DuckDB
): Promise<void> {
  // The app should be an instance of WebpageWorkflow
  if (app && typeof app.run === 'function') {
    return app.run(inputs);
  } else {
    throw new Error('Invalid workflow app provided');
  }
}

export function build_workflow(
  openai_key: string,
  checkpointer: any, // Legacy parameter, no longer used
  duck_db: DuckDB,
  markdown_db: MarkdownDatabase,
  memory_db: LanceDBMemoryStore,
  filter_config?: FilterConfig
): WebpageWorkflow {
  // Return the new WebpageWorkflow instance instead of LangGraph app
  return new WebpageWorkflow(openai_key, duck_db, markdown_db, memory_db, filter_config);
}