import { VisitQueueProcessor, ExtendedPageVisit } from "./visit_queue_processor";
import { OrphanedVisitsManager } from "./orphaned_visits";
import { DuckDB } from "./duck_db";
import { LanceDBMemoryStore } from "./lance_db";
import * as webpageTree from "./webpage_tree";
import * as workflow from "./reconcile_webpage_trees_workflow_vanilla";
import * as duckDbImports from "./duck_db";

// Mock dependencies
jest.mock("./duck_db");
jest.mock("./lance_db");
jest.mock("./webpage_tree");
jest.mock("./reconcile_webpage_trees_workflow_vanilla");

describe("VisitQueueProcessor", () => {
  let processor: VisitQueueProcessor;
  let mockDuckDb: jest.Mocked<DuckDB>;
  let mockMemoryDb: jest.Mocked<LanceDBMemoryStore>;
  let mockWorkflowApp: any;
  let mockOrphanManager: jest.Mocked<OrphanedVisitsManager>;
  
  // Mock functions
  const mockInsertPageActivitySession = webpageTree.insert_page_activity_session_with_tree_management as jest.MockedFunction<
    typeof webpageTree.insert_page_activity_session_with_tree_management
  >;
  const mockGetPageSessions = duckDbImports.get_page_sessions_with_tree_id as jest.MockedFunction<
    typeof duckDbImports.get_page_sessions_with_tree_id
  >;
  const mockRunWorkflow = workflow.run_workflow as jest.MockedFunction<
    typeof workflow.run_workflow
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create mock instances
    mockDuckDb = {} as jest.Mocked<DuckDB>;
    mockMemoryDb = {} as jest.Mocked<LanceDBMemoryStore>;
    mockWorkflowApp = {};
    
    mockOrphanManager = {
      add_orphan: jest.fn(),
      get_orphans_for_tab: jest.fn().mockReturnValue([]),
      remove_orphans_for_tab: jest.fn(),
      get_orphans_for_retry: jest.fn().mockReturnValue([]),
      increment_retry_count: jest.fn(),
      get_stats: jest.fn().mockReturnValue({
        total_orphans: 0,
        orphans_by_tab: new Map(),
        oldest_orphan_age_ms: null
      })
    } as any;
    
    // Default mock implementations
    mockInsertPageActivitySession.mockResolvedValue({
      tree_id: "tree-123",
      was_tree_changed: true
    });
    
    mockGetPageSessions.mockResolvedValue([]);
    mockRunWorkflow.mockResolvedValue(undefined);
    
    // Create processor with test config
    processor = new VisitQueueProcessor(
      mockDuckDb,
      mockMemoryDb,
      mockWorkflowApp,
      mockOrphanManager,
      {
        batch_size: 3,
        batch_timeout: 100,
        orphan_retry_interval: 1000
      }
    );
  });

  afterEach(() => {
    processor.stop();
    jest.useRealTimers();
  });

  describe("enqueue", () => {
    it("should add visit to queue and return position", () => {
      const visit: ExtendedPageVisit = {
        id: "visit-1",
        url: "https://example.com",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Test</html>"
      };
      
      const position = processor.enqueue(visit);
      
      expect(position).toBe(1);
      
      const stats = processor.get_stats();
      expect(stats.queue_length).toBe(1);
    });

    it("should trigger immediate processing for full batch", async () => {
      const visits: ExtendedPageVisit[] = [
        {
          id: "visit-1",
          url: "https://example.com/1",
          referrer: null,
          page_loaded_at: "2024-01-01T12:00:00Z",
          raw_content: "<html>1</html>"
        },
        {
          id: "visit-2",
          url: "https://example.com/2",
          referrer: null,
          page_loaded_at: "2024-01-01T12:01:00Z",
          raw_content: "<html>2</html>"
        },
        {
          id: "visit-3",
          url: "https://example.com/3",
          referrer: null,
          page_loaded_at: "2024-01-01T12:02:00Z",
          raw_content: "<html>3</html>"
        }
      ];
      
      visits.forEach(v => processor.enqueue(v));
      
      // Process should start immediately for full batch
      // Manually call process_queue since we're using fake timers
      await processor.process_queue();
      
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(3);
    });

    it("should schedule delayed processing for partial batch", () => {
      const visit: ExtendedPageVisit = {
        id: "visit-1",
        url: "https://example.com",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Test</html>"
      };
      
      processor.enqueue(visit);
      
      // Should not process immediately
      expect(mockInsertPageActivitySession).not.toHaveBeenCalled();
      
      // Fast-forward time to trigger batch timeout
      jest.advanceTimersByTime(100);
      
      // Now it should process
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(1);
    });
  });

  describe("enqueue_priority", () => {
    it("should add visits to front of queue", () => {
      // Add regular visits first
      processor.enqueue({
        id: "regular-1",
        url: "https://example.com/regular",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Regular</html>"
      });
      
      // Add priority visits
      const priorityVisits: ExtendedPageVisit[] = [
        {
          id: "priority-1",
          url: "https://example.com/priority1",
          referrer: "https://example.com",
          page_loaded_at: "2024-01-01T12:01:00Z",
          raw_content: "<html>Priority 1</html>"
        },
        {
          id: "priority-2",
          url: "https://example.com/priority2",
          referrer: "https://example.com",
          page_loaded_at: "2024-01-01T12:02:00Z",
          raw_content: "<html>Priority 2</html>"
        }
      ];
      
      processor.enqueue_priority(priorityVisits);
      
      const stats = processor.get_stats();
      expect(stats.queue_length).toBe(3);
      
      // Process the queue
      jest.advanceTimersByTime(100);
      
      // Priority visits should be processed first
      expect(mockInsertPageActivitySession).toHaveBeenCalledWith(
        mockDuckDb,
        expect.objectContaining({ id: "priority-1" })
      );
    });
  });

  describe("process_single_visit", () => {
    it("should handle successful visit with tree change", async () => {
      const visit: ExtendedPageVisit = {
        id: "visit-1",
        url: "https://example.com",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Test</html>",
        tab_id: 42
      };
      
      mockInsertPageActivitySession.mockResolvedValue({
        tree_id: "tree-123",
        was_tree_changed: true
      });
      
      mockGetPageSessions.mockResolvedValue([
        {
          id: "visit-1",
          url: "https://example.com",
          tree_id: "tree-123",
          content: "<html>Test</html>",
          referrer: null,
          referrer_page_session_id: null,
          page_loaded_at: "2024-01-01T12:00:00Z"
        } as any
      ]);
      
      await processor.process_single_visit(visit);
      
      expect(mockInsertPageActivitySession).toHaveBeenCalledWith(mockDuckDb, visit);
      expect(mockGetPageSessions).toHaveBeenCalledWith(
        mockDuckDb,
        mockMemoryDb,
        "tree-123"
      );
      expect(mockRunWorkflow).toHaveBeenCalled();
      expect(mockOrphanManager.get_orphans_for_tab).toHaveBeenCalledWith(42);
    });

    it("should handle orphaned visit", async () => {
      const visit: ExtendedPageVisit = {
        id: "orphan-1",
        url: "https://example.com/child",
        referrer: "https://example.com/parent",
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Child</html>",
        opener_tab_id: 10,
        tab_id: 20
      };
      
      mockInsertPageActivitySession.mockResolvedValue({
        tree_id: "tree-456",
        was_tree_changed: true
      });
      
      await processor.process_single_visit(visit);
      
      expect(mockOrphanManager.add_orphan).toHaveBeenCalledWith(visit, 10);
      expect(mockRunWorkflow).not.toHaveBeenCalled(); // Should not run workflow for orphans
    });

    it("should process orphaned children when parent is processed", async () => {
      const parentVisit: ExtendedPageVisit = {
        id: "parent-1",
        url: "https://example.com/parent",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Parent</html>",
        tab_id: 10
      };
      
      const orphanedChild = {
        visit: {
          id: "child-1",
          url: "https://example.com/child",
          referrer: "https://example.com/parent",
          page_loaded_at: "2024-01-01T12:01:00Z",
          raw_content: "<html>Child</html>"
        },
        opener_tab_id: 10,
        arrival_time: Date.now(),
        retry_count: 0
      };
      
      mockOrphanManager.get_orphans_for_tab.mockReturnValue([orphanedChild]);
      
      await processor.process_single_visit(parentVisit);
      
      expect(mockOrphanManager.get_orphans_for_tab).toHaveBeenCalledWith(10);
      expect(mockOrphanManager.remove_orphans_for_tab).toHaveBeenCalledWith(10);
      
      // Child should be re-queued with parent reference
      const stats = processor.get_stats();
      expect(stats.queue_length).toBe(1);
    });

    it("should handle visit with no tree assignment", async () => {
      const visit: ExtendedPageVisit = {
        id: "aggregator-1",
        url: "https://news.ycombinator.com",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>HN</html>"
      };
      
      mockInsertPageActivitySession.mockResolvedValue({
        tree_id: null,
        was_tree_changed: false
      });
      
      await processor.process_single_visit(visit);
      
      expect(mockInsertPageActivitySession).toHaveBeenCalled();
      expect(mockRunWorkflow).not.toHaveBeenCalled();
      expect(mockOrphanManager.add_orphan).not.toHaveBeenCalled();
    });
  });

  describe("process_queue", () => {
    it("should process visits in batches", async () => {
      const visits: ExtendedPageVisit[] = Array.from({ length: 7 }, (_, i) => ({
        id: `visit-${i}`,
        url: `https://example.com/${i}`,
        referrer: null,
        page_loaded_at: `2024-01-01T12:0${i}:00Z`,
        raw_content: `<html>${i}</html>`
      }));
      
      visits.forEach(v => processor.enqueue(v));
      
      // Trigger processing
      await processor.process_queue();
      
      // Should process first batch of 3
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(3);
      
      // Process remaining visits
      await processor.process_queue();
      await processor.process_queue();
      
      // All visits should be processed
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(7);
    });

    it("should handle errors gracefully", async () => {
      const visits: ExtendedPageVisit[] = [
        {
          id: "good-1",
          url: "https://example.com/good",
          referrer: null,
          page_loaded_at: "2024-01-01T12:00:00Z",
          raw_content: "<html>Good</html>"
        },
        {
          id: "bad-1",
          url: "https://example.com/bad",
          referrer: null,
          page_loaded_at: "2024-01-01T12:01:00Z",
          raw_content: "<html>Bad</html>"
        },
        {
          id: "good-2",
          url: "https://example.com/good2",
          referrer: null,
          page_loaded_at: "2024-01-01T12:02:00Z",
          raw_content: "<html>Good 2</html>"
        }
      ];
      
      // Make the second visit fail
      mockInsertPageActivitySession
        .mockResolvedValueOnce({ tree_id: "tree-1", was_tree_changed: true })
        .mockRejectedValueOnce(new Error("Database error"))
        .mockResolvedValueOnce({ tree_id: "tree-3", was_tree_changed: true });
      
      visits.forEach(v => processor.enqueue(v));
      
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      
      await processor.process_queue();
      
      // All three should be attempted
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(3);
      
      // Error should be logged but not stop processing
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error processing page visit"),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    it("should prevent concurrent processing", async () => {
      const visit: ExtendedPageVisit = {
        id: "visit-1",
        url: "https://example.com",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Test</html>"
      };
      
      processor.enqueue(visit);
      
      // Start processing
      const promise1 = processor.process_queue();
      const promise2 = processor.process_queue();
      
      await Promise.all([promise1, promise2]);
      
      // Should only process once despite two calls
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(1);
    });
  });

  describe("orphan retry mechanism", () => {
    it("should periodically retry orphaned visits", () => {
      const orphan = {
        visit: {
          id: "orphan-1",
          url: "https://example.com/orphan",
          referrer: "https://example.com/parent",
          page_loaded_at: "2024-01-01T12:00:00Z",
          raw_content: "<html>Orphan</html>"
        },
        opener_tab_id: 10,
        arrival_time: Date.now(),
        retry_count: 0
      };
      
      mockOrphanManager.get_orphans_for_retry.mockReturnValue([orphan]);
      
      processor.start();
      
      // Advance time to trigger retry interval
      jest.advanceTimersByTime(1000);
      
      expect(mockOrphanManager.get_orphans_for_retry).toHaveBeenCalled();
      expect(mockOrphanManager.increment_retry_count).toHaveBeenCalledWith(orphan);
      
      const stats = processor.get_stats();
      expect(stats.queue_length).toBe(1); // Orphan should be re-queued
    });

    it("should not retry when no orphans available", () => {
      mockOrphanManager.get_orphans_for_retry.mockReturnValue([]);
      
      processor.start();
      
      jest.advanceTimersByTime(1000);
      
      expect(mockOrphanManager.get_orphans_for_retry).toHaveBeenCalled();
      expect(mockOrphanManager.increment_retry_count).not.toHaveBeenCalled();
      
      const stats = processor.get_stats();
      expect(stats.queue_length).toBe(0);
    });
  });

  describe("stats", () => {
    it("should provide comprehensive statistics", () => {
      const visits: ExtendedPageVisit[] = [
        {
          id: "visit-1",
          url: "https://example.com/1",
          referrer: null,
          page_loaded_at: "2024-01-01T12:00:00Z",
          raw_content: "<html>1</html>"
        },
        {
          id: "visit-2",
          url: "https://example.com/2",
          referrer: null,
          page_loaded_at: "2024-01-01T12:01:00Z",
          raw_content: "<html>2</html>"
        }
      ];
      
      visits.forEach(v => processor.enqueue(v));
      
      mockOrphanManager.get_stats.mockReturnValue({
        total_orphans: 3,
        orphans_by_tab: new Map([[10, 2], [20, 1]]),
        oldest_orphan_age_ms: 5000
      });
      
      const stats = processor.get_stats();
      
      expect(stats).toEqual({
        queue_length: 2,
        is_processing: false,
        orphan_stats: {
          total_orphans: 3,
          orphans_by_tab: new Map([[10, 2], [20, 1]]),
          oldest_orphan_age_ms: 5000
        }
      });
    });
  });

  describe("lifecycle", () => {
    it("should start and stop cleanly", () => {
      processor.start();
      
      // Should set up retry timer
      jest.advanceTimersByTime(1000);
      expect(mockOrphanManager.get_orphans_for_retry).toHaveBeenCalled();
      
      processor.stop();
      
      // Should clear timers
      jest.clearAllTimers();
      jest.advanceTimersByTime(1000);
      
      // Should not be called after stop
      expect(mockOrphanManager.get_orphans_for_retry).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple start calls gracefully", () => {
      processor.start();
      processor.start(); // Second call should be ignored
      
      jest.advanceTimersByTime(1000);
      
      // Should only set up one timer
      expect(mockOrphanManager.get_orphans_for_retry).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty queue gracefully", async () => {
      await processor.process_queue();
      
      expect(mockInsertPageActivitySession).not.toHaveBeenCalled();
    });

    it("should handle very large batches", async () => {
      const visits: ExtendedPageVisit[] = Array.from({ length: 100 }, (_, i) => ({
        id: `visit-${i}`,
        url: `https://example.com/${i}`,
        referrer: null,
        page_loaded_at: `2024-01-01T12:00:00Z`,
        raw_content: `<html>${i}</html>`
      }));
      
      visits.forEach(v => processor.enqueue(v));
      
      // Process all visits
      while (processor.get_stats().queue_length > 0) {
        await processor.process_queue();
      }
      
      // All visits should be processed
      expect(mockInsertPageActivitySession).toHaveBeenCalledTimes(100);
    });

    it("should handle visits with missing optional fields", async () => {
      const minimalVisit: ExtendedPageVisit = {
        id: "minimal-1",
        url: "https://example.com",
        referrer: null,
        page_loaded_at: "2024-01-01T12:00:00Z",
        raw_content: "<html>Minimal</html>"
        // No tab_id, opener_tab_id, etc.
      };
      
      await processor.process_single_visit(minimalVisit);
      
      expect(mockInsertPageActivitySession).toHaveBeenCalled();
      expect(mockOrphanManager.get_orphans_for_tab).not.toHaveBeenCalled();
    });
  });
});