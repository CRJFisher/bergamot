import { PageActivitySessionWithoutTree } from "./duck_db_models";
import { dev_log, record_outcome } from "./dev_log";

export interface OrphanedVisit {
  visit: PageActivitySessionWithoutTree & { title: string; visit_id: string };
  opener_tab_id: number;
  arrival_time: number;
  retry_count: number;
}

/**
 * Parks webpage visits whose opener/parent has not been captured yet, keyed by
 * opener tab id, and re-surfaces them once the parent arrives. Parked orphans
 * are bounded by both an age limit and a retry limit so the map cannot grow
 * without end when a parent never arrives.
 */
export class OrphanedVisitsManager {
  private orphaned_visits: Map<number, OrphanedVisit[]> = new Map();
  private max_retries = 5;
  private max_age_ms = 60000;

  add_orphan(
    visit: PageActivitySessionWithoutTree & { title: string; visit_id: string },
    opener_tab_id: number
  ): void {
    dev_log('orphan_parked', {
      visit_id: visit.visit_id,
      url: visit.url,
      opener_tab_id,
      visit_tab_id: (visit as PageActivitySessionWithoutTree & { tab_id?: number }).tab_id,
    });

    const orphan: OrphanedVisit = {
      visit,
      opener_tab_id,
      arrival_time: Date.now(),
      retry_count: 0
    };

    if (!this.orphaned_visits.has(opener_tab_id)) {
      this.orphaned_visits.set(opener_tab_id, []);
    }

    this.orphaned_visits.get(opener_tab_id)!.push(orphan);
    this.cleanup_old_orphans();
  }

  get_orphans_for_tab(tab_id: number): OrphanedVisit[] {
    this.cleanup_old_orphans();
    return this.orphaned_visits.get(tab_id) || [];
  }

  /**
   * Drops every parked orphan the predicate matches (right-to-forget purge).
   *
   * @returns How many orphans were dropped
   */
  purge(matches: (orphan: OrphanedVisit) => boolean): number {
    let dropped = 0;
    for (const [tab_id, orphans] of this.orphaned_visits) {
      const kept = orphans.filter((orphan) => !matches(orphan));
      dropped += orphans.length - kept.length;
      if (kept.length === 0) {
        this.orphaned_visits.delete(tab_id);
      } else if (kept.length !== orphans.length) {
        this.orphaned_visits.set(tab_id, kept);
      }
    }
    return dropped;
  }

  remove_orphans_for_tab(tab_id: number): void {
    this.orphaned_visits.delete(tab_id);
  }

  remove_orphan(orphan: OrphanedVisit): void {
    const orphans = this.orphaned_visits.get(orphan.opener_tab_id);
    if (!orphans) return;

    const index = orphans.indexOf(orphan);
    if (index > -1) {
      orphans.splice(index, 1);
    }

    if (orphans.length === 0) {
      this.orphaned_visits.delete(orphan.opener_tab_id);
    }
  }

  get_orphans_for_retry(): OrphanedVisit[] {
    this.cleanup_old_orphans();

    const orphans_to_retry: OrphanedVisit[] = [];

    for (const [, orphans] of this.orphaned_visits.entries()) {
      for (const orphan of orphans) {
        if (orphan.retry_count < this.max_retries) {
          orphans_to_retry.push(orphan);
        }
      }
    }

    return orphans_to_retry;
  }

  increment_retry_count(orphan: OrphanedVisit): void {
    orphan.retry_count++;

    if (orphan.retry_count >= this.max_retries) {
      const orphans = this.orphaned_visits.get(orphan.opener_tab_id);
      if (orphans) {
        const index = orphans.indexOf(orphan);
        if (index > -1) {
          orphans.splice(index, 1);
          record_outcome({
            visit_id: orphan.visit.visit_id,
            url: orphan.visit.url,
            decision: 'orphan_dropped',
            reason: 'max_retries',
          });
        }

        if (orphans.length === 0) {
          this.orphaned_visits.delete(orphan.opener_tab_id);
        }
      }
    }
  }

  private cleanup_old_orphans(): void {
    const now = Date.now();

    for (const [tab_id, orphans] of this.orphaned_visits.entries()) {
      const fresh_orphans = orphans.filter(orphan => {
        const age = now - orphan.arrival_time;
        if (age > this.max_age_ms) {
          record_outcome({
            visit_id: orphan.visit.visit_id,
            url: orphan.visit.url,
            decision: 'orphan_dropped',
            reason: 'expired',
          });
          return false;
        }
        return true;
      });

      if (fresh_orphans.length === 0) {
        this.orphaned_visits.delete(tab_id);
      } else {
        this.orphaned_visits.set(tab_id, fresh_orphans);
      }
    }
  }

  get_stats(): {
    total_orphans: number;
    orphans_by_tab: Map<number, number>;
    oldest_orphan_age_ms: number | null;
  } {
    this.cleanup_old_orphans();

    let total = 0;
    let oldest_age: number | null = null;
    const by_tab = new Map<number, number>();
    const now = Date.now();

    for (const [tab_id, orphans] of this.orphaned_visits.entries()) {
      total += orphans.length;
      by_tab.set(tab_id, orphans.length);

      for (const orphan of orphans) {
        const age = now - orphan.arrival_time;
        if (oldest_age === null || age > oldest_age) {
          oldest_age = age;
        }
      }
    }

    return {
      total_orphans: total,
      orphans_by_tab: by_tab,
      oldest_orphan_age_ms: oldest_age
    };
  }
}
