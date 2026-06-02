import { WebpageWorkflow } from "./simple_workflow";
import { DuckDB } from "../duck_db";
import { LanceDBMemoryStore } from "../lance_db";
import * as openaiClient from "./openai_client";
import * as webpageFilter from "./webpage_filter";
import * as duckDbQueries from "../duck_db";
import { global_filter_metrics } from "./filter_metrics";
import { PageActivitySessionWithMeta } from "../reconcile_webpage_trees_workflow_models";
import { PageActivitySessionWithoutContent } from "../duck_db_models";
import { FilterConfig } from "./webpage_filter";

type LlmClient = Awaited<ReturnType<typeof openaiClient.get_llm_client>>;
type MockLlmClient = {
  complete: jest.Mock;
  complete_json: jest.Mock;
};

// Mock all dependencies
jest.mock("../duck_db");
jest.mock("../lance_db");
jest.mock("./openai_client");
jest.mock("./webpage_filter");
jest.mock("./filter_metrics");

describe("WebpageWorkflow", () => {
  let workflow: WebpageWorkflow;
  let mockDuckDb: jest.Mocked<DuckDB>;
  let mockMemoryDb: jest.Mocked<LanceDBMemoryStore>;
  let mockLlmClient: MockLlmClient;

  const test_openai_key = "test-openai-key";
  const test_filter_config: FilterConfig = {
    enabled: true,
    log_decisions: true,
    min_confidence: 0.7,
    allowed_types: ["knowledge", "interactive_app"],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
    mockDuckDb = {} as jest.Mocked<DuckDB>;
    mockMemoryDb = {
      put: jest.fn().mockResolvedValue(undefined),
    } as Partial<jest.Mocked<LanceDBMemoryStore>> as jest.Mocked<LanceDBMemoryStore>;

    // Mock LLM client
    mockLlmClient = {
      complete: jest.fn(),
      complete_json: jest.fn(),
    };
    jest
      .spyOn(openaiClient, "get_llm_client")
      .mockResolvedValue(mockLlmClient as Partial<LlmClient> as LlmClient);

    // Mock filter functions
    jest.spyOn(webpageFilter, "classify_webpage").mockResolvedValue({
      page_type: "knowledge",
      confidence: 0.85,
      should_process: true,
      reasoning: "High quality knowledge content",
    });

    jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(true);
    jest.spyOn(webpageFilter, "log_filter_decision").mockImplementation(() => {});

    // Mock DuckDB queries
    jest.spyOn(duckDbQueries, "get_webpage_analysis_for_ids").mockResolvedValue([]);
    jest.spyOn(duckDbQueries, "get_last_modified_trees_with_members_and_analysis")
      .mockResolvedValue({});
    jest.spyOn(duckDbQueries, "insert_webpage_analysis").mockResolvedValue(undefined);
    jest.spyOn(duckDbQueries, "insert_webpage_tree_intentions").mockResolvedValue(undefined);

    // Mock filter metrics
    jest.spyOn(global_filter_metrics, "record_classification").mockImplementation(() => {});
  });

  describe("constructor", () => {
    it("should initialize with all parameters", () => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMemoryDb,
        test_filter_config
      );

      expect(workflow).toBeInstanceOf(WebpageWorkflow);
    });

    it("should initialize without optional parameters", () => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMemoryDb
      );

      expect(workflow).toBeInstanceOf(WebpageWorkflow);
    });

    it("should use default filter config when not provided", () => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMemoryDb
      );

      // The workflow should have the default config
      // This would be tested through the run method
      expect(workflow).toBeInstanceOf(WebpageWorkflow);
    });
  });

  describe("run method", () => {
    const test_inputs = {
      members: [
        {
          id: "page-2",
          url: "https://example.com/page2",
          tree_id: "tree-123",
          analysis: {
            title: "Page 2",
            summary: "Summary of page 2",
            intentions: ["learn"],
          },
        },
      ] as PageActivitySessionWithMeta[],
      new_page: {
        id: "page-2",
        url: "https://example.com/page2",
        tree_id: "tree-123",
        page_loaded_at: "2024-01-01T12:00:00Z",
      } as PageActivitySessionWithoutContent,
      raw_content: "<html><body>Test content</body></html>",
    };

    beforeEach(() => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMemoryDb,
        test_filter_config
      );

      // Setup default mock responses
      mockLlmClient.complete.mockResolvedValue("# Processed Content\n\nTest article");
      mockLlmClient.complete_json.mockResolvedValue({
        title: "Test Article",
        summary: "A test article for unit testing",
        intentions: ["learn", "reference"],
      });
    });

    it("should successfully process a webpage", async () => {
      await workflow.run(test_inputs);

      // Verify classification
      expect(webpageFilter.classify_webpage).toHaveBeenCalledWith(
        test_inputs.new_page.url,
        test_inputs.raw_content,
        expect.any(Function)
      );

      // Verify content processing
      expect(mockLlmClient.complete).toHaveBeenCalledWith(
        expect.stringContaining(test_inputs.raw_content),
        expect.any(String),
        "gpt-4o-mini"
      );

      // Verify analysis
      expect(mockLlmClient.complete_json).toHaveBeenCalled();

      // Verify storage
      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
      expect(mockMemoryDb.put).toHaveBeenCalledWith(
        ["webpage_content"],
        "page-2",
        expect.objectContaining({
          url: "https://example.com/page2",
          title: "Test Article",
        })
      );
    });

    it("should skip processing when page is filtered out", async () => {
      jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(false);

      await workflow.run(test_inputs);

      // Should not process content or store anything
      expect(mockLlmClient.complete).not.toHaveBeenCalled();
      expect(duckDbQueries.insert_webpage_analysis).not.toHaveBeenCalled();
      expect(mockMemoryDb.put).not.toHaveBeenCalled();

      // Should record metrics - filter_reason will be undefined since should_process is false but not due to specific filter rule
      expect(global_filter_metrics.record_classification).toHaveBeenCalledWith(
        test_inputs.new_page.url,
        "knowledge",
        0.85,
        false,
        undefined
      );
    });

    it("should generate tree intentions for multi-member trees", async () => {
      const multi_member_inputs = {
        members: [
          {
            id: "page-1",
            url: "https://example.com/page1",
            tree_id: "tree-123",
            page_loaded_at: "2024-01-01T11:00:00Z",
            analysis: {
              title: "Page 1",
              summary: "Summary of page 1",
              intentions: ["learn"],
            },
          },
          {
            id: "page-2",
            url: "https://example.com/page2",
            tree_id: "tree-123",
            page_loaded_at: "2024-01-01T12:00:00Z",
            analysis: {
              title: "Page 2",
              summary: "Summary of page 2",
              intentions: ["reference"],
            },
          },
        ] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: {
          id: "page-2",
          url: "https://example.com/page2",
          tree_id: "tree-123",
          page_loaded_at: "2024-01-01T12:00:00Z",
        } as PageActivitySessionWithoutContent,
        raw_content: "<html><body>Test content</body></html>",
      };

      mockLlmClient.complete.mockResolvedValue("# Processed Content");
      // classify_webpage is mocked directly, so complete_json is only used for
      // the analysis call and the tree-intentions call.
      mockLlmClient.complete_json
        .mockResolvedValueOnce({
          title: "Test Article",
          summary: "A test article",
          intentions: ["learn"],
        })
        .mockResolvedValueOnce({
          page_id_to_intentions: { "1": ["learn", "reference"] },
        });

      await workflow.run(multi_member_inputs);

      expect(duckDbQueries.insert_webpage_tree_intentions).toHaveBeenCalledWith(
        mockDuckDb,
        "tree-123",
        expect.any(Array)
      );
    });

    it("should handle errors gracefully", async () => {
      const error = new Error("LLM API error");
      mockLlmClient.complete.mockRejectedValue(error);

      await expect(workflow.run(test_inputs)).rejects.toThrow("LLM API error");
    });

    it("should handle pages with no referrer", async () => {
      const inputs_no_referrer = {
        ...test_inputs,
        members: [
          {
            id: "page-2",
            url: "https://example.com/page2",
            tree_id: "tree-123",
            referrer: null,
            analysis: {
              title: "Page 2",
              summary: "Summary",
              intentions: [],
            },
          },
        ] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
      };

      await workflow.run(inputs_no_referrer);

      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
    });
  });

  describe("filter decision logic", () => {
    beforeEach(() => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMemoryDb,
        test_filter_config
      );
    });

    it("should filter by page type", async () => {
      jest.spyOn(webpageFilter, "classify_webpage").mockResolvedValue({
        page_type: "aggregator",
        confidence: 0.95,
        should_process: true,
        reasoning: "Aggregator page",
      });
      jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(false);

      const inputs = {
        members: [{ id: "2", tree_id: "tree-1" }] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: { id: "2", url: "https://twitter.com" } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: "<html>Twitter</html>",
      };

      await workflow.run(inputs);

      expect(global_filter_metrics.record_classification).toHaveBeenCalledWith(
        "https://twitter.com",
        "aggregator",
        0.95,
        false,
        "type_not_allowed"
      );
    });

    it("should filter by confidence threshold", async () => {
      jest.spyOn(webpageFilter, "classify_webpage").mockResolvedValue({
        page_type: "knowledge",
        confidence: 0.5,
        should_process: true,
        reasoning: "Low confidence",
      });
      jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(false);

      const inputs = {
        members: [{ id: "2", tree_id: "tree-1" }] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: { id: "2", url: "https://example.com" } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: "<html>Content</html>",
      };

      await workflow.run(inputs);

      expect(global_filter_metrics.record_classification).toHaveBeenCalledWith(
        "https://example.com",
        "knowledge",
        0.5,
        false,
        "low_confidence"
      );
    });

    it("should respect model recommendation", async () => {
      jest.spyOn(webpageFilter, "classify_webpage").mockResolvedValue({
        page_type: "knowledge",
        confidence: 0.9,
        should_process: false,
        reasoning: "Not relevant content",
      });
      jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(false);

      const inputs = {
        members: [{ id: "2", tree_id: "tree-1" }] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: { id: "2", url: "https://example.com" } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: "<html>Content</html>",
      };

      await workflow.run(inputs);

      expect(global_filter_metrics.record_classification).toHaveBeenCalledWith(
        "https://example.com",
        "knowledge",
        0.9,
        false,
        "model_recommendation"
      );
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMemoryDb
      );

      mockLlmClient.complete.mockResolvedValue("Processed content");
      mockLlmClient.complete_json.mockResolvedValue({
        title: "Title",
        summary: "Summary",
        intentions: [],
      });
    });

    it("should handle single member", async () => {
      const inputs = {
        members: [
          {
            id: "2",
            url: "https://example.com",
            tree_id: "tree-1",
            page_loaded_at: "2024-01-01T12:00:00Z",
            analysis: { title: "Title", summary: "Summary", intentions: [] },
          },
        ] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: {
          id: "2",
          url: "https://example.com",
          tree_id: "tree-1",
          page_loaded_at: "2024-01-01T12:00:00Z",
        } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: "<html>Content</html>",
      };

      await workflow.run(inputs);

      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
      // Single-member trees do not generate tree intentions
      expect(duckDbQueries.insert_webpage_tree_intentions).not.toHaveBeenCalled();
    });

    it("should handle very large content", async () => {
      const large_content = "x".repeat(1000000);
      const inputs = {
        members: [
          {
            id: "2",
            url: "https://example.com",
            tree_id: "tree-1",
            page_loaded_at: "2024-01-01T12:00:00Z",
            analysis: { title: "Title", summary: "Summary", intentions: [] },
          },
        ] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: {
          id: "2",
          url: "https://example.com",
          tree_id: "tree-1",
          page_loaded_at: "2024-01-01T12:00:00Z",
        } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: large_content,
      };

      await workflow.run(inputs);

      expect(mockLlmClient.complete).toHaveBeenCalledWith(
        expect.stringContaining(large_content),
        expect.any(String),
        "gpt-4o-mini"
      );
    });

    it("should handle malformed HTML content", async () => {
      const malformed_html = "<div><p>Unclosed tags <span>";
      const inputs = {
        members: [
          {
            id: "2",
            url: "https://example.com",
            tree_id: "tree-1",
            page_loaded_at: "2024-01-01T12:00:00Z",
            analysis: { title: "Title", summary: "Summary", intentions: [] },
          },
        ] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: {
          id: "2",
          url: "https://example.com",
          tree_id: "tree-1",
          page_loaded_at: "2024-01-01T12:00:00Z",
        } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: malformed_html,
      };

      await workflow.run(inputs);

      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
    });

    it("should handle special characters in URLs", async () => {
      const inputs = {
        members: [
          {
            id: "2",
            url: "https://example.com/page?q=test&foo=<script>alert('xss')</script>",
            tree_id: "tree-1",
            page_loaded_at: "2024-01-01T12:00:00Z",
            analysis: { title: "Title", summary: "Summary", intentions: [] },
          },
        ] as Partial<PageActivitySessionWithMeta>[] as PageActivitySessionWithMeta[],
        new_page: {
          id: "2",
          url: "https://example.com/page?q=test&foo=<script>alert('xss')</script>",
          tree_id: "tree-1",
          page_loaded_at: "2024-01-01T12:00:00Z",
        } as Partial<PageActivitySessionWithoutContent> as PageActivitySessionWithoutContent,
        raw_content: "<html>Content</html>",
      };

      await workflow.run(inputs);

      expect(webpageFilter.classify_webpage).toHaveBeenCalledWith(
        inputs.new_page.url,
        expect.any(String),
        expect.any(Function)
      );
    });
  });
});
