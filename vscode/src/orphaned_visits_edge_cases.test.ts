import { OrphanedVisitsManager } from './orphaned_visits';
import { PageActivitySessionWithoutTreeOrContent } from './duck_db_models';

describe('OrphanedVisitsManager - Edge Cases and Race Conditions', () => {
  let manager: OrphanedVisitsManager;

  beforeEach(() => {
    manager = new OrphanedVisitsManager();
  });

  const create_test_visit = (
    url: string,
    tab_id?: number,
    opener_tab_id?: number,
    referrer?: string
  ): PageActivitySessionWithoutTreeOrContent & { raw_content: string; tab_id?: number; opener_tab_id?: number } => ({
    id: `test-${url}-${Date.now()}`,
    url,
    referrer: referrer || null,
    page_loaded_at: new Date().toISOString(),
    raw_content: 'test content',
    ...(tab_id && { tab_id }),
    ...(opener_tab_id && { opener_tab_id })
  });

  describe('Complex navigation chains', () => {
    it('should handle multiple levels of orphans (grandchild before parent and grandparent)', () => {
      // Grandchild arrives first
      const grandchild = create_test_visit('https://grandchild.com', 789, 456);
      manager.add_orphan(grandchild, 456);
      
      // Then child arrives (also orphaned because parent 123 doesn't exist)
      const child = create_test_visit('https://child.com', 456, 123);
      manager.add_orphan(child, 123);
      
      // Both should be orphaned
      expect(manager.get_orphans_for_tab(456)).toHaveLength(1);
      expect(manager.get_orphans_for_tab(123)).toHaveLength(1);
      
      // Parent arrives - should resolve child
      manager.remove_orphans_for_tab(123);
      expect(manager.get_orphans_for_tab(123)).toHaveLength(0);
      
      // Grandchild should still be orphaned until child is processed
      expect(manager.get_orphans_for_tab(456)).toHaveLength(1);
    });

    it('should handle circular references gracefully', () => {
      // Tab A opens Tab B, Tab B opens Tab C, Tab C tries to reference Tab A
      // const visitA = create_test_visit('https://a.com', 1, undefined);
      const visitB = create_test_visit('https://b.com', 2, 1);
      const visitC = create_test_visit('https://c.com', 3, 2);
      
      // Add B as orphan of A (A not processed yet)
      manager.add_orphan(visitB, 1);
      expect(manager.get_orphans_for_tab(1)).toHaveLength(1);
      
      // Add C as orphan of B (B not processed yet)
      manager.add_orphan(visitC, 2);
      expect(manager.get_orphans_for_tab(2)).toHaveLength(1);
      
      // Stats should show 2 total orphans
      const stats = manager.get_stats();
      expect(stats.total_orphans).toBe(2);
      expect(stats.orphans_by_tab.size).toBe(2);
    });
  });

  describe('Concurrent operations', () => {
    it('should handle rapid addition and removal of orphans', () => {
      const visits: Array<PageActivitySessionWithoutTreeOrContent & { raw_content: string }> = [];
      
      // Rapidly add 100 orphans
      for (let i = 0; i < 100; i++) {
        const visit = create_test_visit(`https://site${i}.com`, i, i % 10);
        visits.push(visit);
        manager.add_orphan(visit, i % 10); // Distribute across 10 parent tabs
      }
      
      // Should have orphans distributed across 10 tabs
      const stats = manager.get_stats();
      expect(stats.total_orphans).toBe(100);
      expect(stats.orphans_by_tab.size).toBe(10);
      
      // Remove half of them
      for (let i = 0; i < 5; i++) {
        manager.remove_orphans_for_tab(i);
      }
      
      const newStats = manager.get_stats();
      expect(newStats.total_orphans).toBe(50);
      expect(newStats.orphans_by_tab.size).toBe(5);
    });

    it('should handle same orphan added multiple times', () => {
      const visit = create_test_visit('https://duplicate.com', 1, 2);
      
      // Add same orphan multiple times
      manager.add_orphan(visit, 2);
      manager.add_orphan(visit, 2);
      manager.add_orphan(visit, 2);
      
      // Should have 3 instances (not deduplicated)
      const orphans = manager.get_orphans_for_tab(2);
      expect(orphans).toHaveLength(3);
    });
  });

  describe('Retry mechanism edge cases', () => {
    it('should handle orphans with different retry counts', () => {
      const visit1 = create_test_visit('https://retry1.com', 1, 2);
      const visit2 = create_test_visit('https://retry2.com', 3, 2);
      
      manager.add_orphan(visit1, 2);
      manager.add_orphan(visit2, 2);
      
      const orphans = manager.get_orphans_for_tab(2);
      
      // Increment retry count for first orphan only
      manager.increment_retry_count(orphans[0]);
      manager.increment_retry_count(orphans[0]);
      
      // Both should still be available for retry
      const retryOrphans = manager.get_orphans_for_retry();
      expect(retryOrphans).toHaveLength(2);
      
      // Max out first orphan
      for (let i = 0; i < 3; i++) {
        manager.increment_retry_count(orphans[0]);
      }
      
      // Now only second orphan should be available
      const finalRetryOrphans = manager.get_orphans_for_retry();
      expect(finalRetryOrphans).toHaveLength(1);
      expect(finalRetryOrphans[0].visit.url).toBe('https://retry2.com');
    });

    it('should preserve retry count across get operations', () => {
      const visit = create_test_visit('https://preserve.com', 1, 2);
      manager.add_orphan(visit, 2);
      
      const orphan1 = manager.get_orphans_for_tab(2)[0];
      manager.increment_retry_count(orphan1);
      
      const orphan2 = manager.get_orphans_for_tab(2)[0];
      expect(orphan2.retry_count).toBe(1);
      
      manager.increment_retry_count(orphan2);
      
      const orphan3 = manager.get_orphans_for_tab(2)[0];
      expect(orphan3.retry_count).toBe(2);
    });
  });

  describe('Memory management', () => {
    it('should not leak memory when orphans are removed', () => {
      // Add and remove many orphans
      for (let i = 0; i < 1000; i++) {
        const visit = create_test_visit(`https://mem${i}.com`, i, i % 100);
        manager.add_orphan(visit, i % 100);
      }
      
      // Remove all orphans
      for (let i = 0; i < 100; i++) {
        manager.remove_orphans_for_tab(i);
      }
      
      const stats = manager.get_stats();
      expect(stats.total_orphans).toBe(0);
      expect(stats.orphans_by_tab.size).toBe(0);
    });

    it('should handle very old orphans gracefully', () => {
      const visit = create_test_visit('https://old.com', 1, 2);
      manager.add_orphan(visit, 2);
      
      // Manually set arrival time to very old
      const orphans = manager.get_orphans_for_tab(2);
      orphans[0].arrival_time = Date.now() - 1000000; // Very old
      
      // Cleanup should remove it
      const orphansAfter = manager.get_orphans_for_tab(2); // This triggers cleanup
      expect(orphansAfter).toHaveLength(0);
    });
  });

  describe('Edge case data', () => {
    it('should handle visits with missing or malformed data', () => {
      const visitNoReferrer = create_test_visit('https://no-ref.com', 1, 2, null);
      const visitEmptyUrl = create_test_visit('', 2, 3);
      
      manager.add_orphan(visitNoReferrer, 2);
      manager.add_orphan(visitEmptyUrl, 3);
      
      expect(manager.get_orphans_for_tab(2)).toHaveLength(1);
      expect(manager.get_orphans_for_tab(3)).toHaveLength(1);
    });

    it('should handle tab_id 0 and negative tab_ids', () => {
      const visit0 = create_test_visit('https://zero.com', 0, 1);
      const visitNeg = create_test_visit('https://negative.com', -1, 2);
      
      manager.add_orphan(visit0, 1);
      manager.add_orphan(visitNeg, 2);
      
      expect(manager.get_orphans_for_tab(1)).toHaveLength(1);
      expect(manager.get_orphans_for_tab(2)).toHaveLength(1);
      
      // Should also handle getting orphans for tab 0 and negative IDs
      manager.add_orphan(create_test_visit('https://child-of-zero.com', 10, 0), 0);
      manager.add_orphan(create_test_visit('https://child-of-neg.com', 11, -1), -1);
      
      expect(manager.get_orphans_for_tab(0)).toHaveLength(1);
      expect(manager.get_orphans_for_tab(-1)).toHaveLength(1);
    });
  });

  describe('Race condition scenarios', () => {
    it('should handle parent arriving while orphan is being retried', () => {
      const child = create_test_visit('https://child.com', 2, 1);
      manager.add_orphan(child, 1);
      
      // Get orphan for retry
      const orphansForRetry = manager.get_orphans_for_retry();
      expect(orphansForRetry).toHaveLength(1);
      
      // Simulate parent arriving and removing orphans while retry is in progress
      manager.remove_orphans_for_tab(1);
      
      // Orphan should be gone
      expect(manager.get_orphans_for_tab(1)).toHaveLength(0);
      
      // Incrementing retry on already-removed orphan should not crash
      expect(() => {
        manager.increment_retry_count(orphansForRetry[0]);
      }).not.toThrow();
    });

    it('should handle multiple children arriving before parent', () => {
      // Simulate multiple tabs opened from same parent in quick succession
      const children = [];
      for (let i = 0; i < 10; i++) {
        const child = create_test_visit(`https://child${i}.com`, 100 + i, 1);
        children.push(child);
        manager.add_orphan(child, 1);
      }
      
      const orphans = manager.get_orphans_for_tab(1);
      expect(orphans).toHaveLength(10);
      
      // All should be available for retry
      const retryOrphans = manager.get_orphans_for_retry();
      expect(retryOrphans).toHaveLength(10);
      
      // When parent processes, all should be removed at once
      manager.remove_orphans_for_tab(1);
      expect(manager.get_orphans_for_tab(1)).toHaveLength(0);
    });
  });

  describe('Statistics accuracy', () => {
    it('should accurately track statistics during complex operations', () => {
      // Start with empty
      let stats = manager.get_stats();
      expect(stats.total_orphans).toBe(0);
      expect(stats.oldest_orphan_age_ms).toBe(null);
      
      // Add some orphans
      const visit1 = create_test_visit('https://stat1.com', 1, 2);
      const visit2 = create_test_visit('https://stat2.com', 3, 4);
      manager.add_orphan(visit1, 2);
      
      // Wait a bit then add another
      const delay = 10;
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Busy wait
      }
      manager.add_orphan(visit2, 4);
      
      stats = manager.get_stats();
      expect(stats.total_orphans).toBe(2);
      expect(stats.orphans_by_tab.get(2)).toBe(1);
      expect(stats.orphans_by_tab.get(4)).toBe(1);
      expect(stats.oldest_orphan_age_ms).toBeGreaterThanOrEqual(delay);
      
      // Remove one set
      manager.remove_orphans_for_tab(2);
      
      stats = manager.get_stats();
      expect(stats.total_orphans).toBe(1);
      expect(stats.orphans_by_tab.has(2)).toBe(false);
      expect(stats.orphans_by_tab.get(4)).toBe(1);
    });
  });
});