import { get_llm_client, LLMClient } from "./openai_client";
import { LlmProvider } from "../config/config_manager";
import {
  ANALYSIS_PROMPT,
  CONTENT_PROCESSING_PROMPT,
  TREE_INTENTIONS_PROMPT,
} from "./prompts";
import {
  classify_webpage,
  should_process_page,
  log_filter_decision,
  DEFAULT_FILTER_CONFIG,
  FilterConfig,
} from "./webpage_filter";
import { global_filter_metrics } from "./filter_metrics";
import {
  DuckDB,
  insert_webpage_analysis,
  insert_webpage_tree_intentions,
} from "../duck_db";
import { WebpageTreeNode } from "../webpage_tree_models";
import { get_tree_with_id } from "../webpage_tree";
import { PageActivitySessionWithoutContent } from "../duck_db_models";
import {
  PageActivitySessionWithMeta,
  PageAnalysisWithoutPageSessionId,
  TreeIntentions,
} from "../reconcile_webpage_trees_workflow_models";
import { LanceDBMemoryStore } from "../lance_db";
import { dev_log, record_outcome } from "../dev_log";
import { reduce_html_for_llm } from "./html_reduce";

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

function webpage_tree_to_md_string(
  node: WebpageTreeNode,
  page_id_to_index: Record<string, number>,
  use_analysis_intentions_if_no_tree_intentions: boolean
): string {
  const all_nodes: WebpageTreeNode[] = [];

  function collect_all_nodes(node: WebpageTreeNode) {
    if (!node) {
      throw new Error("Node is null");
    }
    all_nodes.push(node);
    if (node.children) {
      for (const child of node.children) {
        collect_all_nodes(child);
      }
    }
  }

  collect_all_nodes(node);

  all_nodes.sort((a, b) =>
    a.webpage_session.page_loaded_at.localeCompare(
      b.webpage_session.page_loaded_at
    )
  );

  const lines: string[] = [];

  for (const node of all_nodes) {
    const session = node.webpage_session;

    lines.push(
      `${page_id_to_index[session.id]}: [${session.analysis.title}](${
        session.url
      })`
    );
    lines.push(`   - Summary: ${session.analysis.summary}`);
    if (
      !session.tree_intentions &&
      use_analysis_intentions_if_no_tree_intentions
    ) {
      lines.push(
        `   - Intentions (new page): ${session.analysis.intentions.join("; ")}`
      );
    } else if (session.tree_intentions) {
      lines.push(`   - Intentions: ${session.tree_intentions.join("; ")}`);
    }
  }

  return lines.join("\n");
}

export interface WorkflowLLMOptions {
  /** Pre-built client; bypasses provider selection. Used by tests (fake LLM). */
  llm_client?: LLMClient;
  /** Provider to construct a client for when none is injected. */
  provider?: LlmProvider;
}

export class WebpageWorkflow {
  private openai_key: string;
  private duck_db: DuckDB;
  private memory_db: LanceDBMemoryStore;
  private filter_config: FilterConfig;
  private llm_options: WorkflowLLMOptions;

  constructor(
    openai_key: string,
    duck_db: DuckDB,
    memory_db: LanceDBMemoryStore,
    filter_config?: FilterConfig,
    llm_options: WorkflowLLMOptions = {}
  ) {
    this.openai_key = openai_key;
    this.duck_db = duck_db;
    this.memory_db = memory_db;
    this.filter_config = filter_config || DEFAULT_FILTER_CONFIG;
    this.llm_options = llm_options;
  }

  async run(inputs: {
    members: PageActivitySessionWithMeta[];
    new_page: PageActivitySessionWithoutContent;
    raw_content: string;
    visit_id?: string;
  }): Promise<void> {
    const visit_id = inputs.visit_id ?? inputs.new_page.id;
    try {
      console.log("State: analyzing_page, Status: running");

      const llm_client =
        this.llm_options.llm_client ??
        (await get_llm_client(this.openai_key, this.llm_options.provider ?? 'claude'));

      const classification = await classify_webpage(
        inputs.new_page.url,
        inputs.raw_content,
        llm_client.complete_json.bind(llm_client)
      );

      // Note: Aggregator filtering now happens here via LLM classification
      // Pages classified as 'aggregator' type will be filtered based on config
      // This replaces the previous hardcoded aggregator URL list in webpage_tree.ts
      const should_process = should_process_page(
        classification,
        this.filter_config
      );
      log_filter_decision(
        inputs.new_page.url,
        classification,
        should_process,
        this.filter_config
      );
      dev_log("classify_result", {
        visit_id,
        url: inputs.new_page.url,
        page_type: classification.page_type,
        confidence: classification.confidence,
        should_process,
      });

      // Record metrics
      let filter_reason: string | undefined;
      if (!should_process) {
        if (
          !this.filter_config.allowed_types.includes(classification.page_type)
        ) {
          filter_reason = "type_not_allowed";
        } else if (
          classification.confidence < this.filter_config.min_confidence
        ) {
          filter_reason = "low_confidence";
        } else if (!classification.should_process) {
          filter_reason = "model_recommendation";
        }
      }

      global_filter_metrics.record_classification(
        inputs.new_page.url,
        classification.page_type,
        classification.confidence,
        should_process,
        filter_reason
      );

      if (!should_process) {
        record_outcome({
          visit_id,
          url: inputs.new_page.url,
          page_type: classification.page_type,
          confidence: classification.confidence,
          decision: "dropped",
          reason: filter_reason,
        });
        return;
      }

      // Reduce the raw HTML before the LLM call. The browser captures full
      // body markup (scripts, styles, inline SVG, data: URIs) which is mostly
      // non-content bulk and overruns the model's prompt-length limit on real
      // pages; strip it to the meaningful markup first.
      const reduced = reduce_html_for_llm(inputs.raw_content);
      if (reduced.truncated) {
        dev_log("content_truncated", {
          visit_id,
          url: inputs.new_page.url,
          original_chars: reduced.original_length,
          sent_chars: reduced.content.length,
        });
      }

      // Process content with LLM to extract main content as markdown
      const processed_content = await llm_client.complete(
        `HTML content to process:\n\n${reduced.content}`,
        CONTENT_PROCESSING_PROMPT,
        "fast"
      );

      // Content is now stored in LanceDB only (see memory_db.put below)

      // Analyze the webpage
      const analysis =
        await llm_client.complete_json<PageAnalysisWithoutPageSessionId>(
          `Webpage url: ${inputs.new_page.url}\nWebpage content: ${processed_content}`,
          ANALYSIS_PROMPT,
          "fast"
        );

      const analysis_with_id = {
        page_sesssion_id: inputs.new_page.id,
        ...analysis,
      };
      await insert_webpage_analysis(this.duck_db, analysis_with_id);

      await this.memory_db.put(
        [WEBPAGE_CONTENT_NAMESPACE],
        inputs.new_page.id,
        {
          pageContent: processed_content,
          url: inputs.new_page.url,
          title: analysis_with_id.title,
        }
      );

      // Content + analysis are now in DuckDB and LanceDB. Tree-intention
      // enrichment below is secondary; this is the durable "stored" milestone.
      record_outcome({
        visit_id,
        url: inputs.new_page.url,
        page_type: classification.page_type,
        confidence: classification.confidence,
        decision: "stored",
      });

      const tree_members = inputs.members.map((member) => {
        if (member.id === inputs.new_page.id) {
          return {
            ...member,
            analysis: {
              ...member.analysis,
              ...analysis,
            },
          };
        }
        return member;
      });

      const new_tree = get_tree_with_id(tree_members);

      if (inputs.members.length > 1) {
        const page_id_to_index = Object.fromEntries(
          inputs.members.map((member, index) => [member.id, index])
        );

        const tree_intentions = await llm_client.complete_json<TreeIntentions>(
          `Webpage sequence: ${webpage_tree_to_md_string(
            new_tree,
            page_id_to_index,
            true
          )}`,
          TREE_INTENTIONS_PROMPT,
          "smart"
        );

        const index_to_page_id = Object.fromEntries(
          Object.entries(page_id_to_index).map(([page_id, index]) => [
            index,
            page_id,
          ])
        );

        await insert_webpage_tree_intentions(
          this.duck_db,
          inputs.new_page.tree_id,
          Object.entries(tree_intentions.page_id_to_intentions ?? {}).flatMap(
            ([index, intentions]) => {
              const activity_session_id = index_to_page_id[index];
              if (!activity_session_id) {
                // The LLM returned an index outside the page set; skip it rather
                // than inserting a row with an undefined session id (which would
                // violate the foreign key / corrupt the intentions table).
                console.warn(
                  `Tree intentions: ignoring unknown page index "${index}"`
                );
                return [];
              }
              return [{ activity_session_id, intentions }];
            }
          )
        );
      }

      console.log("\n--- Workflow Completed ---");
      console.log("State: completed, Status: completed");
    } catch (e) {
      console.error("\n--- Workflow Failed ---");
      console.error("Error:", e);
      throw e;
    }
  }
}
