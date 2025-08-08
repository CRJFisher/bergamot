import { WebpageWorkflow } from "./simple_workflow";
import { DuckDB } from "../duck_db";
import { MarkdownDatabase } from "../markdown_db";
import { LanceDBMemoryStore } from "../lance_db";
import { EpisodicMemoryStore } from "../memory/episodic_memory_store";
import { ProceduralMemoryStore } from "../memory/procedural_memory_store";
import { MemoryEnhancedClassifier } from "../memory/memory_enhanced_classifier";
import { EnhancedWebpageFilter } from "./enhanced_webpage_filter";
import * as openaiClient from "./openai_client";
import * as webpageFilter from "./webpage_filter";
import * as duckDbQueries from "../duck_db";
import * as contentAnalyzer from "./content_analyzer";
import { global_filter_metrics } from "./filter_metrics";
import { PageActivitySessionWithMeta } from "../reconcile_webpage_trees_workflow_models";
import { PageActivitySessionWithoutContent } from "../duck_db_models";

// Mock all dependencies
jest.mock("../duck_db");
jest.mock("../markdown_db");
jest.mock("../lance_db");
jest.mock("../memory/episodic_memory_store");
jest.mock("../memory/procedural_memory_store");
jest.mock("../memory/memory_enhanced_classifier");
jest.mock("./enhanced_webpage_filter");
jest.mock("./openai_client");
jest.mock("./webpage_filter");
jest.mock("./content_analyzer");
jest.mock("./filter_metrics");

describe("WebpageWorkflow", () => {
  let workflow: WebpageWorkflow;
  let mockDuckDb: jest.Mocked<DuckDB>;
  let mockMarkdownDb: jest.Mocked<MarkdownDatabase>;
  let mockMemoryDb: jest.Mocked<LanceDBMemoryStore>;
  let mockEpisodicStore: jest.Mocked<EpisodicMemoryStore>;
  let mockProceduralStore: jest.Mocked<ProceduralMemoryStore>;
  let mockLlmClient: any;

  const test_openai_key = "test-openai-key";
  const test_filter_config = {
    min_confidence: 0.7,
    allowed_types: ["knowledge", "interactive_app"],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
    mockDuckDb = {} as jest.Mocked<DuckDB>;
    mockMarkdownDb = {
      upsert: jest.fn().mockResolvedValue({
        save: jest.fn().mockResolvedValue(undefined),
      }),
    } as any;
    mockMemoryDb = {
      put: jest.fn().mockResolvedValue(undefined),
    } as any;
    mockEpisodicStore = {
      initialize: jest.fn().mockResolvedValue(undefined),
    } as any;
    mockProceduralStore = {
      initialize: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock LLM client
    mockLlmClient = {
      complete: jest.fn(),
      complete_json: jest.fn(),
    };
    jest.spyOn(openaiClient, "get_llm_client").mockResolvedValue(mockLlmClient);

    // Mock filter functions
    jest.spyOn(webpageFilter, "classify_webpage").mockResolvedValue({
      page_type: "knowledge",
      confidence: 0.85,
      should_process: true,
      reasoning: "High quality knowledge content",
    });

    jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(true);
    jest.spyOn(webpageFilter, "log_filter_decision").mockImplementation(() => {});

    // Mock content analyzer
    jest.spyOn(contentAnalyzer, "extract_content_features").mockReturnValue({
      word_count: 500,
      has_code: false,
      has_images: true,
      estimated_reading_time: 3,
      language: "en",
      topics: ["technology", "ai"],
    } as any);

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
        mockMarkdownDb,
        mockMemoryDb,
        test_filter_config as any,
        mockEpisodicStore,
        mockProceduralStore
      );

      expect(MemoryEnhancedClassifier).toHaveBeenCalledWith(mockEpisodicStore);
      expect(EnhancedWebpageFilter).toHaveBeenCalledWith(
        mockProceduralStore,
        mockEpisodicStore,
        test_filter_config
      );
    });

    it("should initialize without optional parameters", () => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb
      );

      expect(MemoryEnhancedClassifier).not.toHaveBeenCalled();
      expect(EnhancedWebpageFilter).not.toHaveBeenCalled();
    });

    it("should use default filter config when not provided", () => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb
      );

      // The workflow should have the default config
      // This would be tested through the run method
    });
  });

  describe("run method", () => {
    const test_inputs = {
      members: [
        {
          id: "page-1",
          url: "https://example.com/page1",
          tree_id: "tree-123",
          analysis: {
            title: "Page 1",
            summary: "Summary of page 1",
            intentions: ["learn"],
          },
        },
      ] as PageActivitySessionWithMeta[],
      new_page: {
        id: "page-2",
        url: "https://example.com/page2",
        page_loaded_at: "2024-01-01T12:00:00Z",
      } as PageActivitySessionWithoutContent,
      raw_content: "<html><body>Test content</body></html>",
    };

    beforeEach(() => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        test_filter_config as any
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
      expect(mockMemoryDb.put).toHaveBeenCalled();
      expect(mockMarkdownDb.upsert).toHaveBeenCalled();
    });

    it("should skip processing when page is filtered out", async () => {
      jest.spyOn(webpageFilter, "should_process_page").mockReturnValue(false);

      await workflow.run(test_inputs);

      // Should not process content or store anything
      expect(mockLlmClient.complete).not.toHaveBeenCalled();
      expect(duckDbQueries.insert_webpage_analysis).not.toHaveBeenCalled();
      expect(mockMemoryDb.put).not.toHaveBeenCalled();
      expect(mockMarkdownDb.upsert).not.toHaveBeenCalled();

      // Should record metrics - filter_reason will be undefined since should_process is false but not due to specific filter rule
      expect(global_filter_metrics.record_classification).toHaveBeenCalledWith(
        test_inputs.new_page.url,
        "knowledge",
        0.85,
        false,
        undefined
      );
    });

    it("should handle memory-enhanced classification when available", async () => {
      // Create workflow with episodic store
      const mockMemoryClassifier = {
        classify_with_memory: jest.fn().mockResolvedValue({
          base_classification: {
            page_type: "knowledge",
            confidence: 0.8,
            should_process: true,
          },
          final_classification: {
            page_type: "knowledge",
            confidence: 0.9,
            should_process: true,
          },
          memory_adjustments: {
            influenced_by: ["episode-1", "episode-2"],
          },
        }),
        store_classification_episode: jest.fn().mockResolvedValue("episode-123"),
      };

      (MemoryEnhancedClassifier as jest.Mock).mockImplementation(() => mockMemoryClassifier);

      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        test_filter_config as any,
        mockEpisodicStore
      );

      await workflow.run(test_inputs);

      expect(mockMemoryClassifier.classify_with_memory).toHaveBeenCalled();
      expect(mockMemoryClassifier.store_classification_episode).toHaveBeenCalled();
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
          },
        ] as any,
      };

      await workflow.run(inputs_no_referrer);

      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
    });

    it("should extract and store content features", async () => {
      await workflow.run(test_inputs);

      expect(contentAnalyzer.extract_content_features).toHaveBeenCalledWith(
        test_inputs.new_page.url,
        test_inputs.raw_content
      );

      // Features should be used in memory storage if classifier is present
      expect(mockMemoryDb.put).toHaveBeenCalledWith(
        ["webpage_content"],
        "page-2",
        expect.objectContaining({
          url: "https://example.com/page2",
          title: "Test Article",
        })
      );
    });
  });

  describe("filter decision logic", () => {
    beforeEach(() => {
      workflow = new WebpageWorkflow(
        test_openai_key,
        mockDuckDb,
        mockMarkdownDb,
        mockMemoryDb,
        test_filter_config as any
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
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: { id: "2", url: "https://twitter.com" } as any,
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
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: { id: "2", url: "https://example.com" } as any,
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
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: { id: "2", url: "https://example.com" } as any,
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
        mockMarkdownDb,
        mockMemoryDb
      );
    });

    it("should handle single member", async () => {
      const inputs = {
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: { id: "2", url: "https://example.com" } as any,
        raw_content: "<html>Content</html>",
      };

      mockLlmClient.complete.mockResolvedValue("Processed content");
      mockLlmClient.complete_json.mockResolvedValue({
        title: "Title",
        summary: "Summary",
        intentions: [],
      });

      await workflow.run(inputs);

      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
    });

    it("should handle very large content", async () => {
      const large_content = "x".repeat(1000000);
      const inputs = {
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: { id: "2", url: "https://example.com" } as any,
        raw_content: large_content,
      };

      mockLlmClient.complete.mockResolvedValue("Processed large content");
      mockLlmClient.complete_json.mockResolvedValue({
        title: "Large Page",
        summary: "Summary",
        intentions: [],
      });

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
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: { id: "2", url: "https://example.com" } as any,
        raw_content: malformed_html,
      };

      mockLlmClient.complete.mockResolvedValue("Processed malformed content");
      mockLlmClient.complete_json.mockResolvedValue({
        title: "Page",
        summary: "Summary",
        intentions: [],
      });

      await workflow.run(inputs);

      expect(duckDbQueries.insert_webpage_analysis).toHaveBeenCalled();
    });

    it("should handle special characters in URLs", async () => {
      const inputs = {
        members: [{ id: "1", tree_id: "tree-1" }] as any,
        new_page: {
          id: "2",
          url: "https://example.com/page?q=test&foo=<script>alert('xss')</script>",
        } as any,
        raw_content: "<html>Content</html>",
      };

      mockLlmClient.complete.mockResolvedValue("Processed content");
      mockLlmClient.complete_json.mockResolvedValue({
        title: "Page",
        summary: "Summary",
        intentions: [],
      });

      await workflow.run(inputs);

      expect(webpageFilter.classify_webpage).toHaveBeenCalledWith(
        inputs.new_page.url,
        expect.any(String),
        expect.any(Function)
      );
    });
  });
});