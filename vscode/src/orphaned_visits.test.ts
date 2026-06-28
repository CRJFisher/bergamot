import { OrphanedVisitsManager } from './orphaned_visits';
import { PageActivitySessionWithoutTree } from './duck_db_models';

describe('OrphanedVisitsManager', () => {
  let manager: OrphanedVisitsManager;

  beforeEach(() => {
    manager = new OrphanedVisitsManager();
  });

  const create_test_visit = (
    url: string,
    opener_tab_id?: number
  ): PageActivitySessionWithoutTree & { title: string; visit_id: string } => ({
    id: `test-${url}`,
    visit_id: `visit-${url}`,
    url,
    referrer: 'https://example.com',
    page_loaded_at: new Date().toISOString(),
    title: 'test content',
    ...(opener_tab_id && { opener_tab_id })
  });

  describe('add_orphan', () => {
    it('parks an orphaned visit under its opener tab', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_tab(123);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].visit.url).toBe('https://test.com');
    });

    it('parks multiple orphans for the same tab', () => {
      const visit1 = create_test_visit('https://test1.com', 123);
      const visit2 = create_test_visit('https://test2.com', 123);

      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 123);

      const orphans = manager.get_orphans_for_tab(123);
      expect(orphans).toHaveLength(2);
    });

    it('parks an orphan with retry_count starting at zero', () => {
      manager.add_orphan(create_test_visit('https://test.com', 123), 123);
      expect(manager.get_orphans_for_tab(123)[0].retry_count).toBe(0);
    });
  });

  describe('get_orphans_for_tab', () => {
    it('returns an empty array for a tab with no orphans', () => {
      const orphans = manager.get_orphans_for_tab(999);
      expect(orphans).toHaveLength(0);
    });

    it('returns orphans for the requested tab only', () => {
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
    it('removes all orphans for a specific tab', () => {
      const visit1 = create_test_visit('https://test1.com', 123);
      const visit2 = create_test_visit('https://test2.com', 123);

      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 123);

      expect(manager.get_orphans_for_tab(123)).toHaveLength(2);

      manager.remove_orphans_for_tab(123);

      expect(manager.get_orphans_for_tab(123)).toHaveLength(0);
    });
  });

  describe('remove_orphan', () => {
    it('removes only the targeted orphan and keeps its siblings', () => {
      const visit1 = create_test_visit('https://keep.com', 123);
      const visit2 = create_test_visit('https://drop.com', 123);
      manager.add_orphan(visit1, 123);
      manager.add_orphan(visit2, 123);

      const target = manager
        .get_orphans_for_tab(123)
        .find((orphan) => orphan.visit.url === 'https://drop.com')!;
      manager.remove_orphan(target);

      const remaining = manager.get_orphans_for_tab(123);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].visit.url).toBe('https://keep.com');
    });

    it('drops the tab entry once its last orphan is removed', () => {
      manager.add_orphan(create_test_visit('https://only.com', 123), 123);
      const target = manager.get_orphans_for_tab(123)[0];

      manager.remove_orphan(target);

      expect(manager.get_stats().orphans_by_tab.has(123)).toBe(false);
    });

    it('is a no-op when the orphan is not parked under its opener tab', () => {
      const visit = create_test_visit('https://gone.com', 123);
      manager.add_orphan(visit, 123);
      const target = manager.get_orphans_for_tab(123)[0];
      manager.remove_orphans_for_tab(123);

      expect(() => manager.remove_orphan(target)).not.toThrow();
      expect(manager.get_stats().total_orphans).toBe(0);
    });
  });

  describe('purge', () => {
    it('drops orphans matching the predicate and reports the count', () => {
      manager.add_orphan(create_test_visit('https://a.com', 1), 1);
      manager.add_orphan(create_test_visit('https://b.com', 1), 1);
      manager.add_orphan(create_test_visit('https://c.com', 2), 2);

      const dropped = manager.purge((orphan) => orphan.visit.url === 'https://a.com');

      expect(dropped).toBe(1);
      expect(manager.get_stats().total_orphans).toBe(2);
      expect(manager.get_orphans_for_tab(1).map((o) => o.visit.url)).toEqual([
        'https://b.com',
      ]);
    });

    it('removes the tab entry when every orphan under it is purged', () => {
      manager.add_orphan(create_test_visit('https://a.com', 1), 1);
      manager.add_orphan(create_test_visit('https://b.com', 1), 1);

      const dropped = manager.purge(() => true);

      expect(dropped).toBe(2);
      expect(manager.get_stats().orphans_by_tab.has(1)).toBe(false);
    });

    it('returns zero and changes nothing when no orphan matches', () => {
      manager.add_orphan(create_test_visit('https://a.com', 1), 1);

      const dropped = manager.purge(() => false);

      expect(dropped).toBe(0);
      expect(manager.get_stats().total_orphans).toBe(1);
    });
  });

  describe('get_orphans_for_retry', () => {
    it('returns orphans that have not exceeded max retries', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphans = manager.get_orphans_for_retry();
      expect(orphans).toHaveLength(1);
    });

    it('omits orphans that have exceeded max retries', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphan = manager.get_orphans_for_tab(123)[0];

      for (let i = 0; i < 5; i++) {
        manager.increment_retry_count(orphan);
      }

      const retry_orphans = manager.get_orphans_for_retry();
      expect(retry_orphans).toHaveLength(0);
    });
  });

  describe('increment_retry_count', () => {
    it('increments the retry count of an orphan', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphan = manager.get_orphans_for_tab(123)[0];

      expect(orphan.retry_count).toBe(0);

      manager.increment_retry_count(orphan);
      expect(orphan.retry_count).toBe(1);
    });

    it('drops the orphan once max retries is reached', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);

      const orphan = manager.get_orphans_for_tab(123)[0];

      for (let i = 0; i < 5; i++) {
        manager.increment_retry_count(orphan);
      }

      expect(manager.get_orphans_for_tab(123)).toHaveLength(0);
    });

    it('does not throw when the orphan was already removed', () => {
      const visit = create_test_visit('https://test.com', 123);
      manager.add_orphan(visit, 123);
      const orphan = manager.get_orphans_for_tab(123)[0];
      manager.remove_orphans_for_tab(123);

      expect(() => manager.increment_retry_count(orphan)).not.toThrow();
    });
  });

  describe('get_stats', () => {
    it('reports total, per-tab counts, and oldest age', () => {
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

    it('reports null oldest age when empty', () => {
      const stats = manager.get_stats();
      expect(stats.total_orphans).toBe(0);
      expect(stats.oldest_orphan_age_ms).toBe(null);
    });
  });

  describe('cleanup_old_orphans', () => {
    it('expires orphans older than max age', (done) => {
      const visit = create_test_visit('https://test.com', 123);

      const test_manager = new OrphanedVisitsManager();
      (test_manager as object as { max_age_ms: number }).max_age_ms = 100;

      test_manager.add_orphan(visit, 123);
      expect(test_manager.get_orphans_for_tab(123)).toHaveLength(1);

      setTimeout(() => {
        expect(test_manager.get_orphans_for_tab(123)).toHaveLength(0);
        done();
      }, 150);
    });
  });
});
