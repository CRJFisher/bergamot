#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import os from "os";
import fs from "fs";

// Queries are served by the extension's local HTTP server because it owns the
// single-writer DuckDB connection; this process discovers its port from the
// canonical file the server writes on startup.
export function get_server_base_url(): string | null {
  try {
    const raw = fs.readFileSync(
      path.join(os.homedir(), ".bergamot", "port.json"),
      "utf8"
    );
    const { port } = JSON.parse(raw) as { port: number };
    return port ? `http://localhost:${port}` : null;
  } catch {
    return null;
  }
}

export async function query_server(
  endpoint: string,
  params: Record<string, string>
): Promise<unknown> {
  const base = get_server_base_url();
  if (!base) {
    throw new McpError(
      ErrorCode.InternalError,
      "Bergamot server not running (no ~/.bergamot/port.json). Open the Bergamot VS Code extension."
    );
  }
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${base}${endpoint}${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new McpError(
      ErrorCode.InternalError,
      `Query ${endpoint} failed: ${response.status}`
    );
  }
  return response.json();
}

async function relational_tool(endpoint: string, params: Record<string, string>) {
  const data = await query_server(endpoint, params);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function main() {
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_webpage_content",
        description:
          "Retrieve the extracted main-content (markdown) of a page session's " +
          "public URL. The content is re-downloaded from the public URL and its " +
          "main content extracted (nav/boilerplate removed); it is served from " +
          "the encrypted local cache when previously read, otherwise re-downloaded " +
          "live and cached. Because it reflects a re-download (see `fetched_at`), " +
          "it may differ from the page as originally viewed (dynamic content or " +
          "drift). It is unavailable for pages behind a login wall or paywall, or " +
          "that are dead or redirected: those return an outcome with no content. " +
          "The result is a discriminated object whose `outcome` is `ok` (with " +
          "`content`) or an exclusion (`auth_redirect`, `forbidden`, `paywall`, " +
          "`dead_link`, `non_html`) with a `reason`.",
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
      {
        name: "get_visit_by_url",
        description:
          "Look up the most recent tracked visit for an exact URL (url, title, visited_at)",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", description: "Exact page URL" } },
          required: ["url"],
        },
      },
      {
        name: "search_by_title",
        description:
          "Find a captured page by its exact title and return its metadata",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", description: "Page title" } },
          required: ["title"],
        },
      },
      {
        name: "get_navigation_tree",
        description:
          "Return all page-visit sessions belonging to a navigation tree (a cross-page browsing session)",
        inputSchema: {
          type: "object",
          properties: { tree_id: { type: "string", description: "Navigation tree id" } },
          required: ["tree_id"],
        },
      },
      {
        name: "list_recent_navigation_trees",
        description:
          "List the most recently active navigation trees with their member pages",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max trees to return", default: 5 },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "get_webpage_content":
        return relational_tool("/query/capture_content", {
          page_session_id: String(
            (request.params.arguments as { page_session_id?: string })
              ?.page_session_id ?? ""
          ),
        });
      case "get_visit_by_url":
        return relational_tool("/query/visit_by_url", {
          url: String((request.params.arguments as { url?: string })?.url ?? ""),
        });
      case "search_by_title":
        return relational_tool("/query/page_by_title", {
          title: String((request.params.arguments as { title?: string })?.title ?? ""),
        });
      case "get_navigation_tree":
        return relational_tool("/query/tree", {
          tree_id: String((request.params.arguments as { tree_id?: string })?.tree_id ?? ""),
        });
      case "list_recent_navigation_trees":
        return relational_tool("/query/recent_trees", {
          limit: String((request.params.arguments as { limit?: number })?.limit ?? 5),
        });
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server started");

  process.on("SIGINT", () => {
    console.error("Shutting down MCP server...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("Shutting down MCP server...");
    process.exit(0);
  });
}

// Guard against auto-running when imported (e.g. by tests); only the spawned
// entrypoint process starts the transport.
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
