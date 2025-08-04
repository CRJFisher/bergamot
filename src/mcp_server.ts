import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { LanceDBMemoryStore } from "./agent_memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { DuckDB } from "./duck_db";
import { get_webpage_content } from "./duck_db";
import path from "path";
import * as vscode from "vscode";

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

interface SemanticSearchArgs {
  query: string;
  limit?: number;
}

interface GetWebpageContentArgs {
  page_session_id: string;
}

export class WebpageRAGMCPServer {
  private server: Server;
  private memoryStore: LanceDBMemoryStore;
  private duckDb: DuckDB;

  constructor(
    memoryStore: LanceDBMemoryStore,
    duckDb: DuckDB,
    serverName = "webpage-rag-mcp"
  ) {
    this.memoryStore = memoryStore;
    this.duckDb = duckDb;
    this.server = new Server(
      {
        name: serverName,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "semantic_search",
          description: "Search through the user's browsing history using semantic similarity",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to find relevant webpages",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return",
                default: 10,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "get_webpage_content",
          description: "Retrieve the full content of a specific webpage by ID",
          inputSchema: {
            type: "object",
            properties: {
              page_session_id: {
                type: "string",
                description: "The unique identifier of the webpage session",
              },
            },
            required: ["page_session_id"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "semantic_search":
          return this.handleSemanticSearch(
            request.params.arguments as unknown as SemanticSearchArgs
          );
        case "get_webpage_content":
          return this.handleGetWebpageContent(
            request.params.arguments as unknown as GetWebpageContentArgs
          );
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleSemanticSearch(args: SemanticSearchArgs) {
    try {
      const { query, limit = 10 } = args;
      
      // Search in the memory store
      const searchResults = await this.memoryStore.search(
        [WEBPAGE_CONTENT_NAMESPACE],
        { query, limit }
      );

      // Format results
      const formattedResults = searchResults.map((result) => ({
        id: result.key,
        url: result.value.url,
        title: result.value.title,
        score: result.score,
        preview: result.value.pageContent.substring(0, 200) + "...",
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResults, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Search failed: ${error.message}`
      );
    }
  }

  private async handleGetWebpageContent(args: GetWebpageContentArgs) {
    try {
      const { page_session_id } = args;

      // First try to get from memory store
      const item = await this.memoryStore.get(
        [WEBPAGE_CONTENT_NAMESPACE],
        page_session_id
      );

      if (item) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: page_session_id,
                  url: item.value.url,
                  title: item.value.title,
                  content: item.value.pageContent,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Fallback to DuckDB if not in memory store
      const content = await get_webpage_content(this.duckDb, page_session_id);
      
      if (!content) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Webpage content not found for ID: ${page_session_id}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
                {
                  id: page_session_id,
                  content: content.content_compressed,
                },
                null,
                2
              ),
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve content: ${error.message}`
      );
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MCP Server started");
  }
}

// Export function to create and start server from extension
export async function createAndStartMCPServer(
  context: vscode.ExtensionContext,
  openaiApiKey: string,
  duckDb: DuckDB
): Promise<WebpageRAGMCPServer> {
  // Initialize memory store with embeddings
  const embeddings = new OpenAIEmbeddings({
    apiKey: openaiApiKey,
  });

  const memoryDbPath = path.join(
    context.globalStorageUri.fsPath,
    "webpage_memory.db"
  );

  const memoryStore = await LanceDBMemoryStore.create(memoryDbPath, {
    embeddings,
  });

  const mcpServer = new WebpageRAGMCPServer(memoryStore, duckDb);
  
  // Don't auto-start when used from extension - let extension manage lifecycle
  return mcpServer;
}