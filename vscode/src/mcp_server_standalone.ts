#!/usr/bin/env node

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

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

interface SemanticSearchArgs {
  query: string;
  limit?: number;
}

interface GetWebpageContentArgs {
  page_session_id: string;
}

async function main() {
  // Get configuration from environment variables
  const openai_api_key = process.env.OPENAI_API_KEY;
  const storage_path = process.env.STORAGE_PATH;
  const duck_db_path = process.env.DUCK_DB_PATH;

  if (!openai_api_key || !storage_path || !duck_db_path) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  // Initialize databases
  const duck_db = new DuckDB({ database_path: duck_db_path });
  await duck_db.init();

  const embeddings = new OpenAIEmbeddings({
    apiKey: openai_api_key,
  });

  const memory_db_path = path.join(storage_path, "webpage_memory.db");
  const memory_store = await LanceDBMemoryStore.create(memory_db_path, {
    embeddings,
  });

  // Create MCP server
  const server = new Server(
    {
      name: "webpage-rag-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "semantic_search":
        return handle_semantic_search(
          request.params.arguments as unknown as SemanticSearchArgs,
          memory_store
        );
      case "get_webpage_content":
        return handle_get_webpage_content(
          request.params.arguments as unknown as GetWebpageContentArgs,
          memory_store,
          duck_db
        );
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server started");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down MCP server...");
    await duck_db.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("Shutting down MCP server...");
    await duck_db.close();
    process.exit(0);
  });
}

async function handle_semantic_search(
  args: SemanticSearchArgs,
  memory_store: LanceDBMemoryStore
) {
  try {
    const { query, limit = 10 } = args;

    // Search in the memory store
    const search_results = await memory_store.search(
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

async function handle_get_webpage_content(
  args: GetWebpageContentArgs,
  memory_store: LanceDBMemoryStore,
  duck_db: DuckDB
) {
  try {
    const { page_session_id } = args;

    // First try to get from memory store
    const item = await memory_store.get(
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
    const content = await get_webpage_content(memory_store, page_session_id);

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

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
