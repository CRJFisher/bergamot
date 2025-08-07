import { OrphanedVisitsManager } from './orphaned_visits';
import { PageActivitySessionWithoutTreeOrContent } from './duck_db_models';

describe('OrphanedVisitsManager', () => {
  let manager: OrphanedVisitsManager;

  beforeEach(() => {
    manager = new OrphanedVisitsManager();
  });

  const create_test_visit = (
    url: string,
    opener_tab_id?: number
  ): PageActivitySessionWithoutTreeOrContent & { raw_content: string } => ({
    id: `test-${url}`,
    url,
    referrer: 'https://example.com',
    page_loaded_at: new Date().toISOString(),
    raw_content: 'test content',
    ...(opener_tab_id && { opener_tab_id })
  });

  describe('add_orphan', () => {
    it('should add orphaned visit to the manager', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_tab(123);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].visit.url).toBe('https://test.com');
    });

    it('should add multiple orphans for the same tab', () => {
      const visit1 = create_test_visit('https://test1.com', 123);
      const visit2 = create_test_visit('https://test2.com', 123);
      
      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 123);

      const orphans = manager.get_orphans_for_tab(123);
      expect(orphans).toHaveLength(2);
    });
  });

  describe('get_orphans_for_tab', () => {
    it('should return empty array for tab with no orphans', () => {
      const orphans = manager.get_orphans_for_tab(999);
      expect(orphans).toHaveLength(0);
    });

    it('should return orphans for specific tab only', () => {
      const visit1 = create_test_visit('https://test1.com', 123);
      const visit2 = create_test_visit('https://test2.com', 456);
      
      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 456);

      const orphans123 = manager.get_orphans_for_tab(123);
      const orphans456 = manager.get_orphans_for_tab(456);
      
      expect(orphans123).toHaveLength(1);
      expect(orphans456).toHaveLength(1);
      expect(orphans123[0].visit.url).toBe('https://test1.com');
      expect(orphans456[0].visit.url).toBe('https://test2.com');
    });
  });

  describe('remove_orphans_for_tab', () => {
    it('should remove all orphans for a specific tab', () => {
      const visit1 = create_test_visit('https://test1.com', 123);
      const visit2 = create_test_visit('https://test2.com', 123);
      
      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 123);
      
      expect(manager.get_orphans_for_tab(123)).toHaveLength(2);
      
      manager.remove_orphans_for_tab(123);
      
      expect(manager.get_orphans_for_tab(123)).toHaveLength(0);
    });
  });

  describe('get_orphans_for_retry', () => {
    it('should return orphans that haven\'t exceeded max retries', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_retry();
      expect(orphans).toHaveLength(1);
    });

    it('should not return orphans that exceeded max retries', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_tab(123);
      const orphan = orphans[0];

      // Increment retry count to max
      for (let i = 0; i < 5; i++) {
        manager.increment_retry_count(orphan);
      }

      const retry_orphans = manager.get_orphans_for_retry();
      expect(retry_orphans).toHaveLength(0);
    });
  });

  describe('increment_retry_count', () => {
    it('should increment retry count for an orphan', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_tab(123);
      const orphan = orphans[0];
      
      expect(orphan.retry_count).toBe(0);
      
      manager.increment_retry_count(orphan);
      expect(orphan.retry_count).toBe(1);
    });

    it('should remove orphan when max retries exceeded', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_tab(123);
      const orphan = orphans[0];

      // Increment to max retries
      for (let i = 0; i < 5; i++) {
        manager.increment_retry_count(orphan);
      }

      // Should be removed after exceeding max retries
      expect(manager.get_orphans_for_tab(123)).toHaveLength(0);
    });
  });

  describe('get_stats', () => {
    it('should return correct statistics', () => {
      const visit1 = create_test_visit('https://test1.com', 123);
      const visit2 = create_test_visit('https://test2.com', 123);
      const visit3 = create_test_visit('https://test3.com', 456);
      
      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 123);
      manager.add_orphan(visit3, 456);

      const stats = manager.get_stats();
      
      expect(stats.total_orphans).toBe(3);
      expect(stats.orphans_by_tab.get(123)).toBe(2);
      expect(stats.orphans_by_tab.get(456)).toBe(1);
      expect(stats.oldest_orphan_age_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('is_potential_orphan', () => {
    it('should identify visit with opener_tab_id as potential orphan', () => {
      const visit = {
        id: 'test',
        url: 'https://test.com',
        referrer: 'https://example.com',
        page_loaded_at: new Date().toISOString(),
        opener_tab_id: 123
      } as any;

      expect(OrphanedVisitsManager.is_potential_orphan(visit)).toBe(true);
    });

    it('should identify visit with referrer as potential orphan', () => {
      const visit = {
        id: 'test',
        url: 'https://test.com',
        referrer: 'https://example.com',
        page_loaded_at: new Date().toISOString()
      } as PageActivitySessionWithoutTreeOrContent;

      expect(OrphanedVisitsManager.is_potential_orphan(visit)).toBe(true);
    });

    it('should not identify visit without opener or referrer as orphan', () => {
      const visit = {
        id: 'test',
        url: 'https://test.com',
        referrer: null,
        page_loaded_at: new Date().toISOString()
      } as PageActivitySessionWithoutTreeOrContent;

      expect(OrphanedVisitsManager.is_potential_orphan(visit)).toBe(false);
    });
  });

  describe('cleanup_old_orphans', () => {
    it('should remove orphans older than max age', (done) => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      // Verify orphan exists
      expect(manager.get_orphans_for_tab(123)).toHaveLength(1);

      // Wait for orphan to expire (set max_age_ms to 100ms for testing)
      const test_manager = new OrphanedVisitsManager();
      (test_manager as any).max_age_ms = 100; // Override for testing
      
      test_manager.add_orphan(visit, 123);
      expect(test_manager.get_orphans_for_tab(123)).toHaveLength(1);

      setTimeout(() => {
        // Should be cleaned up after max age
        expect(test_manager.get_orphans_for_tab(123)).toHaveLength(0);
        done();
      }, 150);
    });
  });
});