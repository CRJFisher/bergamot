// Vanilla TypeScript implementation of the webpage reconciliation workflow
// This replaces the LangChain-based implementation with direct OpenAI SDK usage

import { WebpageWorkflow, WorkflowLLMOptions } from "./workflow/simple_workflow";
import { PageActivitySessionWithoutContent } from "./duck_db_models";
import { DuckDB } from "./duck_db";
import { PageActivitySessionWithMeta } from "./reconcile_webpage_trees_workflow_models";
import { LanceDBMemoryStore } from "./lance_db";
import { FilterConfig } from "./workflow/webpage_filter";

export async function run_workflow(
  inputs: {
    members: PageActivitySessionWithMeta[];
    new_page: PageActivitySessionWithoutContent;
    raw_content: string;
    visit_id?: string;
  },
  app: unknown, // Legacy parameter for compatibility
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _duck_db?: DuckDB
): Promise<void> {
  // The app should be an instance of WebpageWorkflow
  // eslint-disable-next-line @typescript-eslint/ban-types
  if (app && typeof (app as { run?: Function }).run === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (app as { run: (inputs: any) => Promise<void> }).run(inputs);
  } else {
    throw new Error("Invalid workflow app provided");
  }
}

export function build_workflow(
  openai_key: string,
  duck_db: DuckDB,
  memory_db: LanceDBMemoryStore,
  filter_config?: FilterConfig,
  llm_options?: WorkflowLLMOptions
): WebpageWorkflow {
  return new WebpageWorkflow(openai_key, duck_db, memory_db, filter_config, llm_options);
}
