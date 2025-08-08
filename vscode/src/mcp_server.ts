import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { LanceDBMemoryStore } from "./lance_db";
import { OpenAIEmbeddings } from "./workflow/embeddings";
import { DuckDB } from "./duck_db";
import { get_webpage_content } from "./duck_db";
import path from "path";
import * as vscode from "vscode";

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

/**
 * Arguments for semantic search tool
 * @interface SemanticSearchArgs
 */
interface SemanticSearchArgs {
  /** Text query to search for */
  query: string;
  /** Maximum number of results to return (optional) */
  limit?: number;
}

/**
 * Arguments for get webpage content tool
 * @interface GetWebpageContentArgs
 */
interface GetWebpageContentArgs {
  /** Unique identifier of the page session to retrieve */
  page_session_id: string;
}

/**
 * MCP (Model Context Protocol) server providing webpage RAG (Retrieval Augmented Generation) capabilities.
 * Exposes semantic search and content retrieval tools for browsing history analysis.
 *
 * @example
 * ```typescript
 * const server = new WebpageRAGMCPServer(memoryStore, duckDb, 'my-rag-server');
 * await server.start();
 * // Server is now available for MCP clients
 * ```
 */
export class WebpageRAGMCPServer {
  private server: Server;
  private memory_store: LanceDBMemoryStore;
  private duck_db: DuckDB;

  /**
   * Creates a new WebpageRAGMCPServer instance.
   *
   * @param memory_store - LanceDB memory store for vector search and content retrieval
   * @param duck_db - DuckDB instance for structured data queries
   * @param server_name - Name identifier for the MCP server (default: 'webpage-rag-mcp')
   *
   * @example
   * ```typescript
   * const server = new WebpageRAGMCPServer(
   *   memoryStore,
   *   duckDbInstance,
   *   'custom-server-name'
   * );
   * ```
   */
  constructor(
    memory_store: LanceDBMemoryStore,
    duck_db: DuckDB,
    server_name = "webpage-rag-mcp"
  ) {
    this.memory_store = memory_store;
    this.duck_db = duck_db;
    this.server = new Server(
      {
        name: server_name,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setup_handlers();
  }

  /**
   * Sets up MCP request handlers for tool listing and execution.
   * Configures handlers for:
   * - semantic_search: Vector-based search through browsing history
   * - get_webpage_content: Retrieve full content of specific webpages
   *
   * @private
   */
  private setup_handlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "semantic_search",
          description:
            "Search through the user's browsing history using semantic similarity",
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
          return this.handle_semantic_search(
            request.params.arguments as unknown as SemanticSearchArgs
          );
        case "get_webpage_content":
          return this.handle_get_webpage_content(
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

  /**
   * Handles semantic search requests through the browsing history.
   * Uses vector embeddings to find pages similar to the query text.
   *
   * @param args - Search arguments containing query and optional limit
   * @returns MCP response with formatted search results
   * @throws {McpError} If search fails
   *
   * @private
   */
  private async handle_semantic_search(args: SemanticSearchArgs) {
    try {
      const { query, limit = 10 } = args;

      // Search in the memory store
      const search_results = await this.memory_store.search(
        [WEBPAGE_CONTENT_NAMESPACE],
        { query, limit }
      );

      // Format results
      const formatted_results = search_results.map((result) => {
        const value = result as unknown as {
          url: string;
          title: string;
          pageContent: string;
          score?: number;
        };
        return {
          id: result.key,
          url: value.url,
          title: value.title,
          score: value.score || result._distance || 0,
          preview: value.pageContent.substring(0, 200) + "...",
        };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatted_results, null, 2),
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

  /**
   * Handles requests to retrieve full webpage content by session ID.
   * First tries memory store, then falls back to direct content lookup.
   *
   * @param args - Content retrieval arguments containing page session ID
   * @returns MCP response with webpage content and metadata
   * @throws {McpError} If content retrieval fails or page not found
   *
   * @private
   */
  private async handle_get_webpage_content(args: GetWebpageContentArgs) {
    try {
      const { page_session_id } = args;

      // First try to get from memory store
      const item = await this.memory_store.get(
        [WEBPAGE_CONTENT_NAMESPACE],
        page_session_id
      );

      if (item) {
        const value = item as unknown as {
          url: string;
          title: string;
          pageContent: string;
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: page_session_id,
                  url: value.url,
                  title: value.title,
                  content: value.pageContent,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Fallback to fetch from memory store directly
      const content = await get_webpage_content(
        this.memory_store,
        page_session_id
      );

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

  /**
   * Starts the MCP server and begins listening for client connections.
   * Uses stdio transport for communication with MCP clients.
   *
   * @returns Promise that resolves when server is started
   * @throws {Error} If server startup fails
   *
   * @example
   * ```typescript
   * const server = new WebpageRAGMCPServer(memoryStore, duckDb);
   * await server.start();
   * console.log('MCP server is running');
   * ```
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MCP Server started");
  }
}

/**
 * Creates and initializes a WebpageRAGMCPServer instance for use within a VSCode extension.
 * Sets up memory store with embeddings and configures the server with extension context.
 *
 * @param context - VSCode extension context for accessing storage paths
 * @param openai_api_key - OpenAI API key for embeddings generation
 * @param duck_db - Initialized DuckDB instance for structured data
 * @returns Promise that resolves to configured WebpageRAGMCPServer instance
 * @throws {Error} If memory store creation or server initialization fails
 *
 * @example
 * ```typescript
 * // In VSCode extension activation
 * export async function activate(context: vscode.ExtensionContext) {
 *   const openaiKey = vscode.workspace.getConfiguration().get<string>('openai.apiKey');
 *   const duckDb = new DuckDB({ database_path: './webpages.db' });
 *   await duckDb.init();
 *
 *   const mcpServer = await create_and_start_mcp_server(context, openaiKey, duckDb);
 *   // Server is ready for use
 * }
 * ```
 */
export async function create_and_start_mcp_server(
  context: vscode.ExtensionContext,
  openai_api_key: string,
  duck_db: DuckDB
): Promise<WebpageRAGMCPServer> {
  // Initialize memory store with embeddings
  const embeddings = new OpenAIEmbeddings({
    apiKey: openai_api_key,
  });

  const memory_db_path = path.join(
    context.globalStorageUri.fsPath,
    "webpage_memory.db"
  );

  const memory_store = await LanceDBMemoryStore.create(memory_db_path, {
    embeddings,
  });

  const mcp_server = new WebpageRAGMCPServer(memory_store, duck_db);

  // Don't auto-start when used from extension - let extension manage lifecycle
  return mcp_server;
}
