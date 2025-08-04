import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import {
  StateGraph,
  START,
  Annotation,
  BaseCheckpointSaver,
} from "@langchain/langgraph";
import { Runnable } from "@langchain/core/runnables";
import { WebpageTreeNode } from "./webpage_tree_models";
import { PageActivitySessionWithoutContent } from "./duck_db_models";
import {
  DuckDB,
  get_last_modified_trees_with_members_and_analysis,
  get_webpage_analysis_for_ids,
  insert_webpage_analysis,
  insert_webpage_tree_intentions,
  insert_webpage_content,
} from "./duck_db";
import { get_tree_with_id } from "./webpage_tree";
type Status = "error" | "running" | "paused" | "completed";
import { get_vscode_or_open_ai_model } from "./vscode_openai_model";
import {
  PageActivitySessionWithMeta,
  PageAnalysis,
  PageAnalysisSchemaWithoutPageSessionId,
  PageAnalysisWithoutPageSessionId,
  TreeIntentions,
  TreeIntentionsSchema,
} from "./reconcile_webpage_trees_workflow_models";
import { BaseMessage } from "@langchain/core/messages";
import { AIMessage } from "@langchain/core/messages";
import { MarkdownDatabase, WebpageTreeNodeCollectionSpec } from "./markdown_db";
import {
  LanceDBMemoryStore,
} from "./agent_memory";

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

const AgentStateAnnotation = Annotation.Root({
  tree: Annotation<WebpageTreeNode>({
    reducer: (x, y) => y || x,
  }),
  initial_members: Annotation<PageActivitySessionWithMeta[]>({
    reducer: (x, y) => y || x,
  }),
  members: Annotation<PageActivitySessionWithMeta[]>({
    reducer: (x, y) => y || x,
  }),
  new_page: Annotation<PageActivitySessionWithoutContent>({
    reducer: (x, y) => y || x,
  }),
  raw_content: Annotation<string>({
    reducer: (x, y) => y || x,
  }),
  other_recent_trees: Annotation<Record<string, PageActivitySessionWithMeta[]>>(
    {
      reducer: (x, y) => y || x,
    }
  ),
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => (x ?? []).concat(y ?? []),
  }),
  page_analysis: Annotation<PageAnalysis[]>({
    reducer: (x, y) => y || x,
  }),
  // Plan-Execute-Judge pattern state
  plan: Annotation<string[]>({
    reducer: (x, y) => y ?? x ?? [],
  }),
  past_steps: Annotation<[string, string][]>({
    reducer: (x, y) => x.concat(y),
  }),
  split_tree_decisions: Annotation<{
    should_split: boolean;
    new_root_ids: string[];
    reasoning: string;
  }>({
    reducer: (x, y) => y || x,
  }),
  current_step: Annotation<string>({
    reducer: (x, y) => y || x,
  }),
  step_result: Annotation<string>({
    reducer: (x, y) => y || x,
  }),
  judge_feedback: Annotation<string>({ reducer: (x, y) => y || x }),
  final_outcome: Annotation<string>({ reducer: (x, y) => y || x }),
  error: Annotation<string>({ reducer: (x, y) => y || x }),
  status: Annotation<Status>({ reducer: (x, y) => y || x }),
});

type AgentState = typeof AgentStateAnnotation.State;

// Define node names following plan-execute-judge pattern
class NodeNames {
  static ANALYSE_NEW_PAGE = "analyse_new_page";
}

function webpage_tree_to_md_string(
  node: WebpageTreeNode,
  page_id_to_index: Record<string, number>,
  use_analysis_intentions_if_no_tree_intentions: boolean
): string {
  // Flatten tree into all nodes, sorted by page_load_time
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

  // Sort by timestamp (chronological order)
  all_nodes.sort((a, b) =>
    a.webpage_session.page_loaded_at.localeCompare(
      b.webpage_session.page_loaded_at
    )
  );

  // Create chronological list format
  const lines: string[] = [];

  for (const node of all_nodes) {
    const session = node.webpage_session;

    // const load_time = new Date(session.page_load_time);
    // const time_str = load_time.toLocaleTimeString("en-US", {
    //   hour12: false,
    //   hour: "2-digit",
    //   minute: "2-digit",
    //   second: "2-digit",
    // });

    // const duration_minutes = Math.round(session.time_on_page / 60000);
    // const duration_str = duration_minutes > 0 ? ` (${duration_minutes}m)` : "";

    lines.push(
      `${page_id_to_index[session.id]}: [${session.analysis.title}](${
        session.url
      })` // *${time_str}*${duration_str}`
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

async function create_analysis_chain(api_key: string): Promise<Runnable> {
  const parser = StructuredOutputParser.fromZodSchema(
    PageAnalysisSchemaWithoutPageSessionId
  );

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert at summarising and deducing the key goals and intentions of someone viewing a web page, based on the content and url.
Analyze the webpage content and provide:
1. A title for the page
2. A concise, telegram-style summary of the content (< 50 words)
3. The goals or intentions for viewing this page, in a list format

{format_instructions}`,
    ],
    ["human", "Webpage url: {url}\nWebpage content: {content}"],
  ]);

  const vscode_model = await get_vscode_or_open_ai_model(
    api_key,
    "gpt-4.1-mini"
  );
  return (
    await prompt.partial({
      format_instructions: parser.getFormatInstructions(),
    })
  )
    .pipe(vscode_model)
    .pipe(parser);
}

async function create_content_processing_chain(
  api_key: string
): Promise<Runnable> {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert at extracting the main content from HTML webpages and converting it to clean markdown format.

Your task is to:
1. Extract the main content from the HTML (articles, blog posts, documentation, etc.)
2. Convert it to well-formatted markdown
3. Strip out all unnecessary elements like:
   - Cookie banners and GDPR notices
   - Navigation menus and sidebars
   - Advertisements and promotional content
   - Footer information
   - Social media widgets
   - Comments sections (unless they're part of the main content)
   - Pop-up overlays
   - Related articles/suggestions (unless core to the content)

Focus on preserving:
- The main article/content text
- Headings and structure
- Important links within the content
- Code blocks, quotes, and other content formatting
- Images that are part of the main content, formatting like ![alt text](http-image-path.png)

Output only the clean markdown content, no JSON formatting or additional commentary text such as notes.`,
    ],
    ["human", "HTML content to process:\n\n{content}"],
  ]);

  const vscode_model = await get_vscode_or_open_ai_model(
    api_key,
    "gpt-4.1-nano"
  );
  return prompt.pipe(vscode_model);
}

async function create_tree_intentions_chain(
  api_key: string
): Promise<Runnable> {
  const parser = StructuredOutputParser.fromZodSchema(TreeIntentionsSchema);

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an expert at analysing a tree of webpages and deducing the main goals and intentions of someone viewing the pages.
You will be given a list of webpages ordered by when they were visited.
Each has a list of intentions which have been previously deduced with the full tree context. 
One of the pages is newly visited and hasn't been analysed within the tree context yet.
Focus on updating the new page's intentions based on the tree context.
The user might not have the same intentions throughout the tree, so don't necessarily bend the intentions to fit into the tree.
If the new page sheds light on the intentions of other pages, update their intentions accordingly. E.g. it might remove an intention or change the terms used.
Each webpage starts with: <page_id>: [title](url)
{format_instructions}`,
    ],
    ["human", "Webpage sequence: {content}"],
  ]);

  const vscode_model = await get_vscode_or_open_ai_model(api_key, "gpt-4.1");
  return (
    await prompt.partial({
      format_instructions: parser.getFormatInstructions(),
    })
  )
    .pipe(vscode_model)
    .pipe(parser);
}

async function analyse_new_page(
  state: AgentState,
  openai_key: string,
  duck_db: DuckDB,
  markdown_db: MarkdownDatabase,
  memory_db: LanceDBMemoryStore
): Promise<Partial<AgentState>> {
  try {
    // Process content with LLM to extract main content as markdown
    const content_processing_chain = await create_content_processing_chain(
      openai_key
    );
    const result = (await content_processing_chain.invoke({
      content: state.raw_content,
    })) as AIMessage;
    const processed_content = result.text;

    // Store processed content in database (compressed)
    await insert_webpage_content(duck_db, state.new_page.id, processed_content);

    const analysis_chain = await create_analysis_chain(openai_key);
    const analysis = (await analysis_chain.invoke({
      url: state.new_page.url,
      content: processed_content, // Use processed content for analysis
    })) as PageAnalysisWithoutPageSessionId;
    const analysis_with_id = {
      page_sesssion_id: state.new_page.id,
      ...analysis,
    };
    await insert_webpage_analysis(duck_db, analysis_with_id);

    await memory_db.put(
      [WEBPAGE_CONTENT_NAMESPACE],
      state.new_page.id,
      {
        pageContent: processed_content,
        url: state.new_page.url,
        title: analysis_with_id.title,
      }
    );

    const tree_members = state.initial_members.map((member) => {
      if (member.id === state.new_page.id) {
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
    const state_update: Partial<AgentState> = {
      page_analysis: [analysis_with_id],
      members: tree_members,
      tree: new_tree,
      messages: [new AIMessage(JSON.stringify(analysis_with_id))],
    };

    if (state.initial_members.length > 1) {
      const tree_intentions_chain = await create_tree_intentions_chain(
        openai_key
      );
      const page_id_to_index = Object.fromEntries(
        state.initial_members.map((member, index) => [member.id, index])
      );
      const tree_intentions = (await tree_intentions_chain.invoke({
        content: webpage_tree_to_md_string(new_tree, page_id_to_index, true),
      })) as TreeIntentions;
      const index_to_page_id = Object.fromEntries(
        Object.entries(page_id_to_index).map(([page_id, index]) => [
          index,
          page_id,
        ])
      );
      await insert_webpage_tree_intentions(
        duck_db,
        state.new_page.tree_id,
        Object.entries(tree_intentions.page_id_to_intentions ?? {}).map(
          ([index, intentions]) => ({
            activity_session_id: index_to_page_id[index],
            intentions,
          })
        )
      );
      const members_with_tree_intentions = tree_members.map((member) => {
        const new_intentions =
          tree_intentions.page_id_to_intentions[page_id_to_index[member.id]] ??
          member.tree_intentions;
        return {
          ...member,
          tree_intentions: new_intentions,
        };
      });
      state_update.members = members_with_tree_intentions;
      state_update.tree = get_tree_with_id(members_with_tree_intentions);
    }

    await (
      await markdown_db.upsert(
        WebpageTreeNodeCollectionSpec,
        state_update.tree,
        "## Webpages"
      )
    ).save();

    return state_update;
  } catch (e) {
    console.error(`\nWorkflow failed:`, e);
    return {
      error: `Failed to analyze page: ${e}`,
      status: "error",
    };
  }
}

export async function run_workflow(
  inputs: {
    members: PageActivitySessionWithMeta[];
    new_page: PageActivitySessionWithoutContent;
    raw_content: string;
  },
  app: ReturnType<typeof build_workflow>,
  duck_db: DuckDB
): Promise<void> {
  const config = {
    configurable: { thread_id: "1" },
    streamMode: "updates" as const,
  };
  try {
    const other_pages_analysis = await get_webpage_analysis_for_ids(
      duck_db,
      inputs.members.map((m) => m.id).filter((id) => id !== inputs.new_page.id)
    );
    const other_recent_trees =
      await get_last_modified_trees_with_members_and_analysis(
        duck_db,
        inputs.members[0].tree_id,
        5
      );
    const init_state = {
      initial_members: inputs.members,
      new_page: inputs.new_page,
      raw_content: inputs.raw_content,
      page_analysis: other_pages_analysis,
      other_recent_trees,
      status: "running",
    } as AgentState;
    // const command = new Command({
    //   goto: NodeNames.ANALYSE_NEW_PAGE,
    //   update: init_state,
    // });
    for await (const latest_state of await app.stream(init_state, config)) {
      console.log(latest_state);
    }
  } catch (e) {
    console.error(`\nWorkflow failed:`, e);
  }

  const final_state = await app.getState(config);
  console.log("\n--- Final State ---");
  for (const [key, value] of Object.entries(final_state.values)) {
    if (key !== "messages" && key !== "raw_content") {
      console.log(`${key}:`, value);
    }
  }
}

export function build_workflow(
  openai_key: string,
  checkpointer: BaseCheckpointSaver<number>,
  duck_db: DuckDB,
  markdown_db: MarkdownDatabase,
  memory_db: LanceDBMemoryStore
): ReturnType<typeof workflow.compile> {
  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode(NodeNames.ANALYSE_NEW_PAGE, (state: AgentState) =>
      analyse_new_page(state, openai_key, duck_db, markdown_db, memory_db)
    )
    .addEdge(START, NodeNames.ANALYSE_NEW_PAGE);

  const app = workflow.compile({
    checkpointer: checkpointer,
  });
  return app;
}
