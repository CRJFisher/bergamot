import { WebpageRAGMCPServer, create_and_start_mcp_server } from "./mcp_server";
import { LanceDBMemoryStore } from "./lance_db";
import { DuckDB } from "./duck_db";
import { get_webpage_content } from "./duck_db";
import { OpenAIEmbeddings } from "./workflow/embeddings";
import {
  McpError,
  ErrorCode,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as vscode from "vscode";
import * as path from "path";

// Mock dependencies
jest.mock("./lance_db");
jest.mock("./duck_db");
jest.mock("./workflow/embeddings");
// Mock SDK modules before importing the source
jest.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: jest.fn(),
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: jest.fn(),
}));

jest.mock("vscode");
jest.mock("path");

// Import Server and StdioServerTransport after mocking
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Mock instances
const mockSetRequestHandler = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockServer = {
  setRequestHandler: mockSetRequestHandler,
  connect: mockConnect,
};

const mockTransportInstance = { mock: "transport" };
const mockStdioServerTransport = StdioServerTransport as jest.MockedClass<
  typeof StdioServerTransport
>;
const mockServerClass = Server as jest.MockedClass<typeof Server>;

// Setup mock implementations
mockServerClass.mockImplementation(() => mockServer as any);
mockStdioServerTransport.mockReturnValue(mockTransportInstance as any);

// Mock implementations
const mockMemoryStore = {
  search: jest.fn(),
  get: jest.fn(),
  create: jest.fn(),
};

const mockDuckDB = {
  connection: {},
};

const mockEmbeddings = {
  embedQuery: jest.fn(),
  embedDocuments: jest.fn(),
};

const mockGetWebpageContent = get_webpage_content as jest.MockedFunction<
  typeof get_webpage_content
>;

// Mock LanceDBMemoryStore static method
(LanceDBMemoryStore.create as jest.Mock) = jest
  .fn()
  .mockResolvedValue(mockMemoryStore);
(OpenAIEmbeddings as jest.Mock) = jest
  .fn()
  .mockImplementation(() => mockEmbeddings);

describe("WebpageRAGMCPServer", () => {
  let server: WebpageRAGMCPServer;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetRequestHandler.mockClear();
    server = new WebpageRAGMCPServer(
      mockMemoryStore as unknown as LanceDBMemoryStore,
      mockDuckDB as unknown as DuckDB
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize server with default name and version", () => {
      expect(mockServer).toBeDefined();
      expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    });

    it("should initialize server with custom name", () => {
      // Clear previous calls
      mockSetRequestHandler.mockClear();

      const customServer = new WebpageRAGMCPServer(
        mockMemoryStore as unknown as LanceDBMemoryStore,
        mockDuckDB as unknown as DuckDB,
        "custom-server-name"
      );

      expect(customServer).toBeDefined();
      expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe("handler setup", () => {
    it("should register ListTools handler", () => {
      expect(mockSetRequestHandler).toHaveBeenCalledWith(
        ListToolsRequestSchema,
        expect.any(Function)
      );
    });

    it("should register CallTool handler", () => {
      expect(mockSetRequestHandler).toHaveBeenCalledWith(
        CallToolRequestSchema,
        expect.any(Function)
      );
    });
  });

  describe("ListTools handler", () => {
    it("should return correct tool definitions", async () => {
      const listToolsHandler = mockSetRequestHandler.mock.calls.find(
        (call) => call[0] === ListToolsRequestSchema
      )[1];

      const result = await listToolsHandler();

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0]).toEqual({
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
      });

      expect(result.tools[1]).toEqual({
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
      });
    });
  });

  describe("CallTool handler", () => {
    // eslint-disable-next-line @typescript-eslint/ban-types
    let callToolHandler: Function;

    beforeEach(() => {
      callToolHandler = mockSetRequestHandler.mock.calls.find(
        (call) => call[0] === CallToolRequestSchema
      )[1];
    });

    describe("semantic_search tool", () => {
      it("should handle successful search", async () => {
        const mockSearchResults = [
          {
            key: "page-123",
            url: "https://example.com/page1",
            title: "Test Page 1",
            pageContent:
              "This is a long test content that should be truncated in the preview because it exceeds 200 characters and we only want to show a preview of the content to the user...",
            _distance: 0.95,
          },
          {
            key: "page-456",
            url: "https://example.com/page2",
            title: "Test Page 2",
            pageContent:
              "Another test page with different content for testing purposes...",
            score: 0.85,
            _distance: 0.15,
          },
        ];

        mockMemoryStore.search.mockResolvedValue(mockSearchResults);

        const request = {
          params: {
            name: "semantic_search",
            arguments: {
              query: "test query",
              limit: 5,
            },
          },
        };

        const result = await callToolHandler(request);

        expect(mockMemoryStore.search).toHaveBeenCalledWith(
          ["webpage_content"],
          { query: "test query", limit: 5 }
        );

        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");

        const parsedText = JSON.parse(result.content[0].text);
        expect(parsedText).toHaveLength(2);
        expect(parsedText[0]).toEqual({
          id: "page-123",
          url: "https://example.com/page1",
          title: "Test Page 1",
          score: 0.95,
          preview:
            "This is a long test content that should be truncated in the preview because it exceeds 200 characters and we only want to show a preview of the content to the user......",
        });
      });

      it("should use default limit when not provided", async () => {
        mockMemoryStore.search.mockResolvedValue([]);

        const request = {
          params: {
            name: "semantic_search",
            arguments: {
              query: "test query",
            },
          },
        };

        await callToolHandler(request);

        expect(mockMemoryStore.search).toHaveBeenCalledWith(
          ["webpage_content"],
          { query: "test query", limit: 10 }
        );
      });

      it("should handle search errors", async () => {
        mockMemoryStore.search.mockRejectedValue(new Error("Search failed"));

        const request = {
          params: {
            name: "semantic_search",
            arguments: {
              query: "test query",
            },
          },
        };

        await expect(callToolHandler(request)).rejects.toThrow(McpError);
        await expect(callToolHandler(request)).rejects.toThrow(
          "Search failed: Search failed"
        );
      });

      it("should handle search results with missing fields", async () => {
        const mockSearchResults = [
          {
            key: "page-123",
            url: "https://example.com/page1",
            title: "Test Page 1",
            pageContent: "Short content",
            // Missing score and _distance
          },
        ];

        mockMemoryStore.search.mockResolvedValue(mockSearchResults);

        const request = {
          params: {
            name: "semantic_search",
            arguments: {
              query: "test query",
            },
          },
        };

        const result = await callToolHandler(request);
        const parsedText = JSON.parse(result.content[0].text);

        expect(parsedText[0].score).toBe(0);
        expect(parsedText[0].preview).toBe("Short content...");
      });
    });

    describe("get_webpage_content tool", () => {
      it("should retrieve content from memory store", async () => {
        const mockItem = {
          key: "page-123",
          url: "https://example.com/page1",
          title: "Test Page",
          pageContent: "Full page content here",
        };

        mockMemoryStore.get.mockResolvedValue(mockItem);

        const request = {
          params: {
            name: "get_webpage_content",
            arguments: {
              page_session_id: "page-123",
            },
          },
        };

        const result = await callToolHandler(request);

        expect(mockMemoryStore.get).toHaveBeenCalledWith(
          ["webpage_content"],
          "page-123"
        );

        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");

        const parsedText = JSON.parse(result.content[0].text);
        expect(parsedText).toEqual({
          id: "page-123",
          url: "https://example.com/page1",
          title: "Test Page",
          content: "Full page content here",
        });
      });

      it("should fallback to get_webpage_content function", async () => {
        mockMemoryStore.get.mockResolvedValue(null);
        mockGetWebpageContent.mockResolvedValue({
          content_compressed: "Decompressed content from fallback",
        });

        const request = {
          params: {
            name: "get_webpage_content",
            arguments: {
              page_session_id: "page-456",
            },
          },
        };

        const result = await callToolHandler(request);

        expect(mockMemoryStore.get).toHaveBeenCalledWith(
          ["webpage_content"],
          "page-456"
        );
        expect(mockGetWebpageContent).toHaveBeenCalledWith(
          mockMemoryStore,
          "page-456"
        );

        const parsedText = JSON.parse(result.content[0].text);
        expect(parsedText).toEqual({
          id: "page-456",
          content: "Decompressed content from fallback",
        });
      });

      it("should handle content not found", async () => {
        mockMemoryStore.get.mockResolvedValue(null);
        mockGetWebpageContent.mockResolvedValue(null);

        const request = {
          params: {
            name: "get_webpage_content",
            arguments: {
              page_session_id: "nonexistent",
            },
          },
        };

        await expect(callToolHandler(request)).rejects.toThrow(McpError);
        await expect(callToolHandler(request)).rejects.toThrow(
          "Webpage content not found for ID: nonexistent"
        );
      });

      it("should handle fallback errors", async () => {
        mockMemoryStore.get.mockResolvedValue(null);
        mockGetWebpageContent.mockRejectedValue(new Error("Fallback failed"));

        const request = {
          params: {
            name: "get_webpage_content",
            arguments: {
              page_session_id: "error-case",
            },
          },
        };

        await expect(callToolHandler(request)).rejects.toThrow(McpError);
        await expect(callToolHandler(request)).rejects.toThrow(
          "Failed to retrieve content: Fallback failed"
        );
      });

      it("should preserve McpError when thrown from fallback", async () => {
        mockMemoryStore.get.mockResolvedValue(null);
        const mcpError = new McpError(
          ErrorCode.InvalidRequest,
          "Custom MCP error"
        );
        mockGetWebpageContent.mockRejectedValue(mcpError);

        const request = {
          params: {
            name: "get_webpage_content",
            arguments: {
              page_session_id: "mcp-error-case",
            },
          },
        };

        await expect(callToolHandler(request)).rejects.toThrow(mcpError);
      });
    });

    describe("unknown tool", () => {
      it("should handle unknown tool name", async () => {
        const request = {
          params: {
            name: "unknown_tool",
            arguments: {},
          },
        };

        await expect(callToolHandler(request)).rejects.toThrow(McpError);
        await expect(callToolHandler(request)).rejects.toThrow(
          "Unknown tool: unknown_tool"
        );
      });
    });
  });

  describe("start method", () => {
    it("should connect to transport and log startup message", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await server.start();

      expect(mockStdioServerTransport).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalledWith(mockTransportInstance);
      expect(consoleSpy).toHaveBeenCalledWith("MCP Server started");

      consoleSpy.mockRestore();
    });

    it("should handle connection errors", async () => {
      mockConnect.mockRejectedValueOnce(new Error("Connection failed"));

      await expect(server.start()).rejects.toThrow("Connection failed");
    });
  });
});

describe("create_and_start_mcp_server", () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      globalStorageUri: {
        fsPath: "/mock/storage/path",
      },
    } as vscode.ExtensionContext;

    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));
  });

  it("should create server with embeddings and memory store", async () => {
    const mockMemoryStoreInstance = { mock: "memory-store" };
    (LanceDBMemoryStore.create as jest.Mock).mockResolvedValue(
      mockMemoryStoreInstance
    );

    const result = await create_and_start_mcp_server(
      mockContext,
      "test-api-key",
      mockDuckDB as unknown as DuckDB
    );

    expect(OpenAIEmbeddings).toHaveBeenCalledWith({
      apiKey: "test-api-key",
    });

    expect(path.join).toHaveBeenCalledWith(
      "/mock/storage/path",
      "webpage_memory.db"
    );

    expect(LanceDBMemoryStore.create).toHaveBeenCalledWith(
      "/mock/storage/path/webpage_memory.db",
      { embeddings: mockEmbeddings }
    );

    expect(result).toBeInstanceOf(WebpageRAGMCPServer);
  });

  it("should handle memory store creation errors", async () => {
    (LanceDBMemoryStore.create as jest.Mock).mockRejectedValue(
      new Error("Memory store creation failed")
    );

    await expect(
      create_and_start_mcp_server(
        mockContext,
        "test-api-key",
        mockDuckDB as unknown as DuckDB
      )
    ).rejects.toThrow("Memory store creation failed");
  });

  it("should handle embeddings creation errors", async () => {
    (OpenAIEmbeddings as jest.Mock).mockImplementation(() => {
      throw new Error("Invalid API key");
    });

    await expect(
      create_and_start_mcp_server(
        mockContext,
        "invalid-key",
        mockDuckDB as unknown as DuckDB
      )
    ).rejects.toThrow("Invalid API key");
  });
});
