import { get_llm_client } from './openai_client';
import { 
  ANALYSIS_PROMPT, 
  CONTENT_PROCESSING_PROMPT, 
  TREE_INTENTIONS_PROMPT 
} from './prompts';
import {
  classify_webpage,
  should_process_page,
  log_filter_decision,
  DEFAULT_FILTER_CONFIG,
  FilterConfig
} from './webpage_filter';
import { global_filter_metrics } from './filter_metrics';
import {
  DuckDB,
  get_last_modified_trees_with_members_and_analysis,
  get_webpage_analysis_for_ids,
  insert_webpage_analysis,
  insert_webpage_tree_intentions,
  insert_webpage_content,
} from '../duck_db';
import { WebpageTreeNode } from '../webpage_tree_models';
import { get_tree_with_id } from '../webpage_tree';
import { PageActivitySessionWithoutContent } from '../duck_db_models';
import {
  PageActivitySessionWithMeta,
  PageAnalysisWithoutPageSessionId,
  TreeIntentions,
} from '../reconcile_webpage_trees_workflow_models';
import { MarkdownDatabase, WebpageTreeNodeCollectionSpec } from '../markdown_db';
import { LanceDBMemoryStore } from '../agent_memory';

const WEBPAGE_CONTENT_NAMESPACE = 'webpage_content';

function webpage_tree_to_md_string(
  node: WebpageTreeNode,
  page_id_to_index: Record<string, number>,
  use_analysis_intentions_if_no_tree_intentions: boolean
): string {
  const all_nodes: WebpageTreeNode[] = [];

  function collect_all_nodes(node: WebpageTreeNode) {
    if (!node) {
      throw new Error('Node is null');
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
        `   - Intentions (new page): ${session.analysis.intentions.join('; ')}`
      );
    } else if (session.tree_intentions) {
      lines.push(`   - Intentions: ${session.tree_intentions.join('; ')}`);
    }
  }

  return lines.join('\n');
}

export class WebpageWorkflow {
  private openai_key: string;
  private duck_db: DuckDB;
  private markdown_db: MarkdownDatabase;
  private memory_db: LanceDBMemoryStore;
  private filter_config: FilterConfig;

  constructor(
    openai_key: string,
    duck_db: DuckDB,
    markdown_db: MarkdownDatabase,
    memory_db: LanceDBMemoryStore,
    filter_config?: FilterConfig
  ) {
    this.openai_key = openai_key;
    this.duck_db = duck_db;
    this.markdown_db = markdown_db;
    this.memory_db = memory_db;
    this.filter_config = filter_config || DEFAULT_FILTER_CONFIG;
  }

  async run(inputs: {
    members: PageActivitySessionWithMeta[];
    new_page: PageActivitySessionWithoutContent;
    raw_content: string;
  }): Promise<void> {
    try {
      console.log('State: analyzing_page, Status: running');
      
      const other_pages_analysis = await get_webpage_analysis_for_ids(
        this.duck_db,
        inputs.members.map((m) => m.id).filter((id) => id !== inputs.new_page.id)
      );
      
      const other_recent_trees = await get_last_modified_trees_with_members_and_analysis(
        this.duck_db,
        inputs.members[0].tree_id,
        5
      );

      const llm_client = await get_llm_client(this.openai_key);
      
      // First, classify the webpage to determine if it should be processed
      const classification = await classify_webpage(
        inputs.new_page.url,
        inputs.raw_content,
        llm_client.complete_json.bind(llm_client)
      );
      
      const should_process = should_process_page(classification, this.filter_config);
      log_filter_decision(inputs.new_page.url, classification, should_process, this.filter_config);
      
      // Record metrics
      let filter_reason: string | undefined;
      if (!should_process) {
        if (!this.filter_config.allowed_types.includes(classification.page_type)) {
          filter_reason = 'type_not_allowed';
        } else if (classification.confidence < this.filter_config.min_confidence) {
          filter_reason = 'low_confidence';
        } else if (!classification.should_process) {
          filter_reason = 'model_recommendation';
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
        console.log('\n--- Workflow Skipped: Page filtered out ---');
        console.log('State: completed, Status: completed (filtered)');
        return;
      }
      
      // Process content with LLM to extract main content as markdown
      const processed_content = await llm_client.complete(
        `HTML content to process:\n\n${inputs.raw_content}`,
        CONTENT_PROCESSING_PROMPT,
        'gpt-4o-mini'
      );

      // Store processed content in database (compressed)
      await insert_webpage_content(this.duck_db, inputs.new_page.id, processed_content);

      // Analyze the webpage
      const analysis = await llm_client.complete_json<PageAnalysisWithoutPageSessionId>(
        `Webpage url: ${inputs.new_page.url}\nWebpage content: ${processed_content}`,
        ANALYSIS_PROMPT,
        'gpt-4o-mini'
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
      
      let new_tree = get_tree_with_id(tree_members);
      let final_members = tree_members;

      if (inputs.members.length > 1) {
        const page_id_to_index = Object.fromEntries(
          inputs.members.map((member, index) => [member.id, index])
        );
        
        const tree_intentions = await llm_client.complete_json<TreeIntentions>(
          `Webpage sequence: ${webpage_tree_to_md_string(new_tree, page_id_to_index, true)}`,
          TREE_INTENTIONS_PROMPT,
          'gpt-4o'
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
          Object.entries(tree_intentions.page_id_to_intentions ?? {}).map(
            ([index, intentions]) => ({
              activity_session_id: index_to_page_id[index],
              intentions,
            })
          )
        );
        
        final_members = tree_members.map((member) => {
          const new_intentions =
            tree_intentions.page_id_to_intentions[page_id_to_index[member.id]] ??
            member.tree_intentions;
          return {
            ...member,
            tree_intentions: new_intentions,
          };
        });
        
        new_tree = get_tree_with_id(final_members);
      }

      await (
        await this.markdown_db.upsert(
          WebpageTreeNodeCollectionSpec,
          new_tree,
          '## Webpages'
        )
      ).save();

      console.log('\n--- Workflow Completed ---');
      console.log('State: completed, Status: completed');
      
    } catch (e) {
      console.error('\n--- Workflow Failed ---');
      console.error('Error:', e);
      throw e;
    }
  }
}