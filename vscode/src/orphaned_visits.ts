/**
 * Orphaned Visits Management
 * 
 * Handles webpage visits that arrive before their parent/opener pages are processed.
 * This occurs when browser tabs are opened from other tabs, but the child page
 * visit is processed before the parent page visit completes.
 */

import { PageActivitySessionWithoutTreeOrContent } from "./duck_db_models";

/**
 * Represents a webpage visit that arrived before its opener/parent page was processed
 * @interface OrphanedVisit
 */
export interface OrphanedVisit {
  /** The page visit data including content */
  visit: PageActivitySessionWithoutTreeOrContent & { raw_content: string };
  /** Browser tab ID of the page that opened this page */
  opener_tab_id: number;
  /** Timestamp when this orphaned visit was first detected */
  arrival_time: number;
  /** Number of times processing has been attempted */
  retry_count: number;
}

/**
 * Manages webpage visits that arrive before their parent pages are processed.
 * 
 * When a user opens a link from one page to another, the browser extension may
 * detect the new page visit before the original page's visit has been fully processed.
 * This manager temporarily holds such "orphaned" visits and retries processing them
 * once their parent pages become available.
 * 
 * @example
 * ```typescript
 * const manager = new OrphanedVisitsManager();
 * 
 * // Add an orphaned visit
 * manager.add_orphan(visitData, parentTabId);
 * 
 * // Check for orphans when a parent page is processed
 * const orphans = manager.get_orphans_for_tab(tabId);
 * if (orphans.length > 0) {
 *   // Process the orphaned children
 *   manager.remove_orphans_for_tab(tabId);
 * }
 * 
 * // Get statistics
 * const stats = manager.get_stats();
 * console.log(`Managing ${stats.total_orphans} orphaned visits`);
 * ```
 */
export class OrphanedVisitsManager {
  private orphaned_visits: Map<number, OrphanedVisit[]> = new Map();
  private max_retries = 5;
  private max_age_ms = 60000; // 1 minute

  /**
   * Adds a webpage visit to the orphaned visits collection.
   * The visit will be retried later when its opener page becomes available.
   * 
   * @param visit - The page visit data that couldn't be processed immediately
   * @param opener_tab_id - Browser tab ID of the page that opened this page
   * 
   * @example
   * ```typescript
   * manager.add_orphan({
   *   id: 'session-123',
   *   url: 'https://example.com/article',
   *   referrer: 'https://news.site.com',
   *   raw_content: '<html>...</html>',
   *   page_loaded_at: '2024-01-01T12:00:00Z'
   * }, 42); // Tab 42 opened this page
   * ```
   */
  add_orphan(
    visit: PageActivitySessionWithoutTreeOrContent & { raw_content: string },
    opener_tab_id: number
  ): void {
    console.log(`🚸 Adding orphaned visit for tab ${opener_tab_id}:`, {
      url: visit.url,
      opener_tab_id,
      visit_tab_id: (visit as PageActivitySessionWithoutTreeOrContent & { tab_id?: number }).tab_id
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
   * Retrieves all orphaned visits that are waiting for a specific tab to be processed.
   * Automatically cleans up old orphans before returning results.
   * 
   * @param tab_id - Browser tab ID to check for waiting orphans
   * @returns Array of orphaned visits waiting for this tab
   * 
   * @example
   * ```typescript
   * // When processing a parent page
   * const orphans = manager.get_orphans_for_tab(42);
   * if (orphans.length > 0) {
   *   console.log(`Found ${orphans.length} orphaned children for tab 42`);
   *   // Process the orphaned visits...
   * }
   * ```
   */
  get_orphans_for_tab(tab_id: number): OrphanedVisit[] {
    this.cleanup_old_orphans();
    return this.orphaned_visits.get(tab_id) || [];
  }

  /**
   * Removes all orphaned visits for a specific tab after they've been successfully processed.
   * 
   * @param tab_id - Browser tab ID to remove orphans for
   * 
   * @example
   * ```typescript
   * const orphans = manager.get_orphans_for_tab(42);
   * // ... process all orphaned visits ...
   * manager.remove_orphans_for_tab(42); // Clean up processed orphans
   * ```
   */
  remove_orphans_for_tab(tab_id: number): void {
    this.orphaned_visits.delete(tab_id);
  }

  /**
   * Retrieves all orphaned visits that are eligible for retry processing.
   * Excludes orphans that have exceeded the maximum retry count.
   * Automatically cleans up old orphans before returning results.
   * 
   * @returns Array of orphaned visits that should be retried
   * 
   * @example
   * ```typescript
   * // Periodic retry processing
   * setInterval(() => {
   *   const orphansToRetry = manager.get_orphans_for_retry();
   *   orphansToRetry.forEach(orphan => {
   *     // Attempt to process the orphan again
   *     manager.increment_retry_count(orphan);
   *   });
   * }, 5000);
   * ```
   */
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

  /**
   * Increments the retry count for an orphaned visit.
   * Automatically removes the orphan if it exceeds the maximum retry limit.
   * 
   * @param orphan - The orphaned visit to increment retry count for
   * 
   * @example
   * ```typescript
   * const orphansToRetry = manager.get_orphans_for_retry();
   * orphansToRetry.forEach(orphan => {
   *   try {
   *     // Attempt processing...
   *     processOrphanedVisit(orphan.visit);
   *   } catch (error) {
   *     manager.increment_retry_count(orphan); // Try again later
   *   }
   * });
   * ```
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
   * Retrieves comprehensive statistics about currently managed orphaned visits.
   * Automatically cleans up old orphans before calculating statistics.
   * 
   * @returns Object containing orphan statistics
   * 
   * @example
   * ```typescript
   * const stats = manager.get_stats();
   * console.log(`Total orphans: ${stats.total_orphans}`);
   * console.log(`Oldest orphan age: ${stats.oldest_orphan_age_ms}ms`);
   * 
   * stats.orphans_by_tab.forEach((count, tabId) => {
   *   console.log(`Tab ${tabId}: ${count} orphans`);
   * });
   * ```
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
   * Determines if a webpage visit might be an orphan based on its metadata.
   * Checks for presence of opener_tab_id or referrer fields that suggest a parent relationship.
   * 
   * @param visit - The page visit to analyze
   * @returns True if the visit has characteristics of a potential orphan
   * 
   * @example
   * ```typescript
   * if (OrphanedVisitsManager.is_potential_orphan(visit)) {
   *   console.log('This visit might need orphan handling');
   *   // Check if parent exists, add to orphan manager if not...
   * }
   * ```
   */
  static is_potential_orphan(
    visit: PageActivitySessionWithoutTreeOrContent
  ): boolean {
    // Check if visit has opener_tab_id field (from browser extension)
    const has_opener = !!(visit as PageActivitySessionWithoutTreeOrContent & { opener_tab_id?: number }).opener_tab_id;
    
    // Also check if it has a referrer but we might not find the parent
    const has_referrer = !!visit.referrer;
    
    return has_opener || has_referrer;
  }
}