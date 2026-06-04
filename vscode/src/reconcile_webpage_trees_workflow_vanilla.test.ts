import { build_workflow } from "./reconcile_webpage_trees_workflow_vanilla";
import { WebpageWorkflow } from "./workflow/simple_workflow";
import { DuckDB } from "./duck_db";
import { LanceDBMemoryStore } from "./lance_db";
import { FilterConfig } from "./workflow/webpage_filter";

// Mock all dependencies
jest.mock("./workflow/simple_workflow");
jest.mock("./duck_db");
jest.mock("./lance_db");

describe("reconcile_webpage_trees_workflow_vanilla", () => {
  let mockDuckDb: jest.Mocked<DuckDB>;
  let mockMemoryDb: jest.Mocked<LanceDBMemoryStore>;
  let mockWorkflowInstance: jest.Mocked<WebpageWorkflow>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDuckDb = {} as jest.Mocked<DuckDB>;
    mockMemoryDb = {} as jest.Mocked<LanceDBMemoryStore>;

    mockWorkflowInstance = {
      run: jest.fn().mockResolvedValue(undefined),
    } as Partial<jest.Mocked<WebpageWorkflow>> as jest.Mocked<WebpageWorkflow>;

    (WebpageWorkflow as jest.Mock).mockImplementation(() => mockWorkflowInstance);
  });

  describe("build_workflow", () => {
    it("should create a WebpageWorkflow instance with all parameters", () => {
      const openai_key = "test-key-123";
      const filter_config: FilterConfig = { min_confidence: 0.7 } as Partial<FilterConfig> as FilterConfig;

      const result = build_workflow(
        openai_key,
        mockDuckDb,
        mockMemoryDb,
        filter_config
      );

      expect(WebpageWorkflow).toHaveBeenCalledWith(
        openai_key,
        mockDuckDb,
        mockMemoryDb,
        filter_config,
        undefined
      );
      expect(result).toBe(mockWorkflowInstance);
    });

    it("should create a WebpageWorkflow instance without optional parameters", () => {
      const openai_key = "test-key-456";

      const result = build_workflow(
        openai_key,
        mockDuckDb,
        mockMemoryDb
      );

      expect(WebpageWorkflow).toHaveBeenCalledWith(
        openai_key,
        mockDuckDb,
        mockMemoryDb,
        undefined,
        undefined
      );
      expect(result).toBe(mockWorkflowInstance);
    });

    it("should forward llm_options to the workflow", () => {
      const result = build_workflow(
        "test-key-opts",
        mockDuckDb,
        mockMemoryDb,
        undefined,
        { provider: "claude" }
      );

      expect(WebpageWorkflow).toHaveBeenCalledWith(
        "test-key-opts",
        mockDuckDb,
        mockMemoryDb,
        undefined,
        { provider: "claude" }
      );
      expect(result).toBe(mockWorkflowInstance);
    });
  });
});
