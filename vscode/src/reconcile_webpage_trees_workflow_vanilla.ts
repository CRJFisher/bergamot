// Vanilla TypeScript implementation of the webpage reconciliation workflow:
// direct LLM-SDK usage with no graph framework.

import { WebpageWorkflow, WorkflowLLMOptions } from "./workflow/simple_workflow";
import { DuckDB } from "./duck_db";
import { LanceDBMemoryStore } from "./lance_db";
import { FilterConfig } from "./workflow/webpage_filter";

export function build_workflow(
  openai_key: string,
  duck_db: DuckDB,
  memory_db: LanceDBMemoryStore,
  filter_config?: FilterConfig,
  llm_options?: WorkflowLLMOptions
): WebpageWorkflow {
  return new WebpageWorkflow(openai_key, duck_db, memory_db, filter_config, llm_options);
}
