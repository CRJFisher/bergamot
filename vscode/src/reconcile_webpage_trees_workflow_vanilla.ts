// Vanilla TypeScript implementation of the webpage reconciliation workflow
// This replaces the LangChain-based implementation with direct OpenAI SDK usage

import { WebpageWorkflow } from "./workflow/simple_workflow";
import { PageActivitySessionWithoutContent } from "./duck_db_models";
import { DuckDB } from "./duck_db";
import { PageActivitySessionWithMeta } from "./reconcile_webpage_trees_workflow_models";
import { MarkdownDatabase } from "./markdown_db";
import { LanceDBMemoryStore } from "./lance_db";
import { FilterConfig } from "./workflow/webpage_filter";
import { EpisodicMemoryStore } from "./memory/episodic_memory_store";
import { ProceduralMemoryStore } from "./memory/procedural_memory_store";

export async function run_workflow(
  inputs: {
    members: PageActivitySessionWithMeta[];
    new_page: PageActivitySessionWithoutContent;
    raw_content: string;
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
  checkpointer: unknown, // Legacy parameter, no longer used
  duck_db: DuckDB,
  markdown_db: MarkdownDatabase,
  memory_db: LanceDBMemoryStore,
  filter_config?: FilterConfig,
  episodic_store?: EpisodicMemoryStore,
  procedural_store?: ProceduralMemoryStore
): WebpageWorkflow {
  // Return the new WebpageWorkflow instance instead of LangGraph app
  return new WebpageWorkflow(
    openai_key,
    duck_db,
    markdown_db,
    memory_db,
    filter_config,
    episodic_store,
    procedural_store
  );
}
