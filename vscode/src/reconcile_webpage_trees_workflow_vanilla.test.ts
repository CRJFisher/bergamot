import { run_workflow, build_workflow } from "./reconcile_webpage_trees_workflow_vanilla";
import { WebpageWorkflow } from "./workflow/simple_workflow";
import { DuckDB } from "./duck_db";
import { MarkdownDatabase } from "./markdown_db";
import { LanceDBMemoryStore } from "./lance_db";
import { EpisodicMemoryStore } from "./memory/episodic_memory_store";
import { ProceduralMemoryStore } from "./memory/procedural_memory_store";
import { PageActivitySessionWithMeta } from "./reconcile_webpage_trees_workflow_models";
import { PageActivitySessionWithoutContent } from "./duck_db_models";

// Mock all dependencies
jest.mock("./workflow/simple_workflow");
jest.mock("./duck_db");
jest.mock("./markdown_db");
jest.mock("./lance_db");
jest.mock("./memory/episodic_memory_store");
jest.mock("./memory/procedural_memory_store");

describe("reconcile_webpage_trees_workflow_vanilla", () => {
  let mockDuckDb: jest.Mocked<DuckDB>;
  let mockMarkdownDb: jest.Mocked<MarkdownDatabase>;
  let mockMemoryDb: jest.Mocked<LanceDBMemoryStore>;
  let mockEpisodicStore: jest.Mocked<EpisodicMemoryStore>;
  let mockProceduralStore: jest.Mocked<ProceduralMemoryStore>;
  let mockWorkflowInstance: jest.Mocked<WebpageWorkflow>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
    mockDuckDb = {} as jest.Mocked<DuckDB>;
    mockMarkdownDb = {} as jest.Mocked<MarkdownDatabase>;
    mockMemoryDb = {} as jest.Mocked<LanceDBMemoryStore>;
    mockEpisodicStore = {} as jest.Mocked<EpisodicMemoryStore>;
    mockProceduralStore = {} as jest.Mocked<ProceduralMemoryStore>;

    // Create mock workflow instance
    mockWorkflowInstance = {
      run: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock WebpageWorkflow constructor
    (WebpageWorkflow as jest.Mock).mockImplementation(() => mockWorkflowInstance);
  });

  describe("build_workflow", () => {
    it("should create a WebpageWorkflow instance with all parameters", () => {
      const openai_key = "test-key-123";
      const filter_config = { min_confidence: 0.7 };

      const result = build_workflow(
        openai_key,
        null, // Legacy checkpointer parameter
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        filter_config as any,
        mockEpisodicStore,
        mockProceduralStore
      );

      expect(WebpageWorkflow).toHaveBeenCalledWith(
        openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        filter_config,
        mockEpisodicStore,
        mockProceduralStore
      );
      expect(result).toBe(mockWorkflowInstance);
    });

    it("should create a WebpageWorkflow instance without optional parameters", () => {
      const openai_key = "test-key-456";

      const result = build_workflow(
        openai_key,
        null,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb
      );

      expect(WebpageWorkflow).toHaveBeenCalledWith(
        openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        undefined,
        undefined,
        undefined
      );
      expect(result).toBe(mockWorkflowInstance);
    });
  });

  describe("run_workflow", () => {
    const test_inputs = {
      members: [
        {
          id: "member-1",
          url: "https://example.com/page1",
          tree_id: "tree-123",
        },
      ] as PageActivitySessionWithMeta[],
      new_page: {
        id: "new-page-1",
        url: "https://example.com/page2",
      } as PageActivitySessionWithoutContent,
      raw_content: "<html>Test content</html>",
    };

    it("should run workflow when valid app is provided", async () => {
      await run_workflow(test_inputs, mockWorkflowInstance, mockDuckDb);

      expect(mockWorkflowInstance.run).toHaveBeenCalledWith(test_inputs);
    });

    it("should handle app with run function", async () => {
      const custom_app = {
        run: jest.fn().mockResolvedValue(undefined),
      };

      await run_workflow(test_inputs, custom_app, mockDuckDb);

      expect(custom_app.run).toHaveBeenCalledWith(test_inputs);
    });

    it("should throw error when invalid app is provided", async () => {
      const invalid_app = { no_run_method: true };

      await expect(
        run_workflow(test_inputs, invalid_app, mockDuckDb)
      ).rejects.toThrow("Invalid workflow app provided");
    });

    it("should throw error when app is null", async () => {
      await expect(
        run_workflow(test_inputs, null, mockDuckDb)
      ).rejects.toThrow("Invalid workflow app provided");
    });

    it("should throw error when app is undefined", async () => {
      await expect(
        run_workflow(test_inputs, undefined, mockDuckDb)
      ).rejects.toThrow("Invalid workflow app provided");
    });

    it("should handle duck_db parameter (legacy compatibility)", async () => {
      // The duck_db parameter is ignored but should not cause issues
      await run_workflow(test_inputs, mockWorkflowInstance, mockDuckDb);
      await run_workflow(test_inputs, mockWorkflowInstance, undefined);
      await run_workflow(test_inputs, mockWorkflowInstance);

      // All calls should succeed
      expect(mockWorkflowInstance.run).toHaveBeenCalledTimes(3);
    });
  });

  describe("integration scenarios", () => {
    it("should handle workflow creation and execution", async () => {
      const openai_key = "test-key-789";
      const filter_config = {
        min_confidence: 0.8,
        allowed_types: ["article", "documentation"],
      };

      // Build workflow
      const workflow = build_workflow(
        openai_key,
        null,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        filter_config as any,
        mockEpisodicStore,
        mockProceduralStore
      );

      // Prepare inputs
      const inputs = {
        members: [
          {
            id: "page-1",
            url: "https://example.com/doc",
            tree_id: "tree-456",
            analysis: {
              title: "Documentation Page",
              summary: "A helpful documentation page",
              intentions: ["learn", "reference"],
            },
          },
        ] as PageActivitySessionWithMeta[],
        new_page: {
          id: "page-2",
          url: "https://example.com/api",
          page_loaded_at: "2024-01-01T12:00:00Z",
        } as PageActivitySessionWithoutContent,
        raw_content: "<html><body>API Documentation</body></html>",
      };

      // Run workflow
      await run_workflow(inputs, workflow, mockDuckDb);

      expect(mockWorkflowInstance.run).toHaveBeenCalledWith(inputs);
    });

    it("should handle errors in workflow execution", async () => {
      const error_message = "Workflow processing failed";
      mockWorkflowInstance.run.mockRejectedValue(new Error(error_message));

      const inputs = {
        members: [] as PageActivitySessionWithMeta[],
        new_page: {} as PageActivitySessionWithoutContent,
        raw_content: "",
      };

      await expect(
        run_workflow(inputs, mockWorkflowInstance, mockDuckDb)
      ).rejects.toThrow(error_message);
    });
  });

  describe("edge cases", () => {
    it("should handle empty inputs", async () => {
      const empty_inputs = {
        members: [],
        new_page: {
          id: "",
          url: "",
        } as PageActivitySessionWithoutContent,
        raw_content: "",
      };

      await run_workflow(empty_inputs, mockWorkflowInstance);

      expect(mockWorkflowInstance.run).toHaveBeenCalledWith(empty_inputs);
    });

    it("should handle very large content", async () => {
      const large_content = "x".repeat(1000000); // 1MB of content
      const inputs = {
        members: [],
        new_page: {
          id: "large-page",
          url: "https://example.com/large",
        } as PageActivitySessionWithoutContent,
        raw_content: large_content,
      };

      await run_workflow(inputs, mockWorkflowInstance);

      expect(mockWorkflowInstance.run).toHaveBeenCalledWith(inputs);
    });

    it("should handle special characters in content", async () => {
      const special_content = '<script>alert("XSS")</script>\\n\r\t';
      const inputs = {
        members: [],
        new_page: {
          id: "special-page",
          url: "https://example.com/special?param=<value>",
        } as PageActivitySessionWithoutContent,
        raw_content: special_content,
      };

      await run_workflow(inputs, mockWorkflowInstance);

      expect(mockWorkflowInstance.run).toHaveBeenCalledWith(inputs);
    });
  });
});