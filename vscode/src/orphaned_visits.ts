/**
 * Orphaned Visits Management
 * Handles pages that arrive before their parent/opener pages
 */

import { PageActivitySessionWithoutTreeOrContent } from "./duck_db_models";

export interface OrphanedVisit {
  visit: PageActivitySessionWithoutTreeOrContent & { raw_content: string };
  opener_tab_id: number;
  arrival_time: number;
  retry_count: number;
}

export class OrphanedVisitsManager {
  private orphaned_visits: Map<number, OrphanedVisit[]> = new Map();
  private max_retries = 5;
  private max_age_ms = 60000; // 1 minute

  /**
   * Add an orphaned visit that references a non-existent opener
   */
  add_orphan(
    visit: PageActivitySessionWithoutTreeOrContent & { raw_content: string },
    opener_tab_id: number
  ): void {
    console.log(`🚸 Adding orphaned visit for tab ${opener_tab_id}:`, {
      url: visit.url,
      opener_tab_id,
      visit_tab_id: (visit as any).tab_id
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

  /**
   * Check if there are orphaned visits waiting for a specific tab
   */
  get_orphans_for_tab(tab_id: number): OrphanedVisit[] {
    this.cleanup_old_orphans();
    return this.orphaned_visits.get(tab_id) || [];
  }

  /**
   * Remove orphans for a specific tab (after they've been processed)
   */
  remove_orphans_for_tab(tab_id: number): void {
    this.orphaned_visits.delete(tab_id);
  }

  /**
   * Get all orphaned visits for retry processing
   */
  get_orphans_for_retry(): OrphanedVisit[] {
    this.cleanup_old_orphans();
    
    const orphans_to_retry: OrphanedVisit[] = [];
    
    for (const [tab_id, orphans] of this.orphaned_visits.entries()) {
      for (const orphan of orphans) {
        if (orphan.retry_count < this.max_retries) {
          orphans_to_retry.push(orphan);
        }
      }
    }
    
    return orphans_to_retry;
  }

  /**
   * Increment retry count for an orphan
   */
  increment_retry_count(orphan: OrphanedVisit): void {
    orphan.retry_count++;
    
    // Remove if max retries exceeded
    if (orphan.retry_count >= this.max_retries) {
      const orphans = this.orphaned_visits.get(orphan.opener_tab_id);
      if (orphans) {
        const index = orphans.indexOf(orphan);
        if (index > -1) {
          orphans.splice(index, 1);
          console.log(`❌ Orphan exceeded max retries, removing:`, {
            url: orphan.visit.url,
            opener_tab_id: orphan.opener_tab_id,
            retries: orphan.retry_count
          });
        }
        
        // Clean up empty arrays
        if (orphans.length === 0) {
          this.orphaned_visits.delete(orphan.opener_tab_id);
        }
      }
    }
  }

  /**
   * Clean up orphans that are too old
   */
  private cleanup_old_orphans(): void {
    const now = Date.now();
    
    for (const [tab_id, orphans] of this.orphaned_visits.entries()) {
      const fresh_orphans = orphans.filter(orphan => {
        const age = now - orphan.arrival_time;
        if (age > this.max_age_ms) {
          console.log(`🗑️ Removing old orphan:`, {
            url: orphan.visit.url,
            opener_tab_id: orphan.opener_tab_id,
            age_ms: age
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

  /**
   * Get statistics about orphaned visits
   */
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

  /**
   * Check if a visit might be an orphan based on its data
   */
  static is_potential_orphan(
    visit: PageActivitySessionWithoutTreeOrContent
  ): boolean {
    // Check if visit has opener_tab_id field (from browser extension)
    const has_opener = !!(visit as any).opener_tab_id;
    
    // Also check if it has a referrer but we might not find the parent
    const has_referrer = !!visit.referrer;
    
    return has_opener || has_referrer;
  }
}