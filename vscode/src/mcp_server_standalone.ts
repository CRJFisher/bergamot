#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { LanceDBMemoryStore } from "./agent_memory";
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
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const storagePath = process.env.STORAGE_PATH;
  const duckDbPath = process.env.DUCK_DB_PATH;

  if (!openaiApiKey || !storagePath || !duckDbPath) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  // Initialize databases
  const duckDb = new DuckDB({ database_path: duckDbPath });
  await duckDb.init();

  const embeddings = new OpenAIEmbeddings({
    apiKey: openaiApiKey,
  });

  const memoryDbPath = path.join(storagePath, "webpage_memory.db");
  const memoryStore = await LanceDBMemoryStore.create(memoryDbPath, {
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "semantic_search":
        return handleSemanticSearch(
          request.params.arguments as unknown as SemanticSearchArgs,
          memoryStore
        );
      case "get_webpage_content":
        return handleGetWebpageContent(
          request.params.arguments as unknown as GetWebpageContentArgs,
          memoryStore,
          duckDb
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
    await duckDb.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("Shutting down MCP server...");
    await duckDb.close();
    process.exit(0);
  });
}

async function handleSemanticSearch(
  args: SemanticSearchArgs,
  memoryStore: LanceDBMemoryStore
) {
  try {
    const { query, limit = 10 } = args;
    
    // Search in the memory store
    const searchResults = await memoryStore.search(
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

async function handleGetWebpageContent(
  args: GetWebpageContentArgs,
  memoryStore: LanceDBMemoryStore,
  duckDb: DuckDB
) {
  try {
    const { page_session_id } = args;

    // First try to get from memory store
    const item = await memoryStore.get(
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
    const content = await get_webpage_content(duckDb, page_session_id);
    
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