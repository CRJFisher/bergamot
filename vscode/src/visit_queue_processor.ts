/**
 * Visit Queue Processor
 * 
 * Handles asynchronous batch processing of webpage visits with retry logic,
 * orphan handling, and performance optimizations.
 */

import { DuckDB } from "./duck_db";
import {
  PageActivitySessionWithoutTree,
  PageActivitySession
} from "./duck_db_models";
import { OrphanedVisitsManager } from "./orphaned_visits";
import { insert_page_activity_session_with_tree_management } from "./webpage_tree";
import { run_page_capture } from "./workflow/page_capture_pipeline";
import { load_inbox, remove_visit } from "./visit_inbox";
import { record_outcome, format_error_detail } from "./dev_log";

/**
 * Extended visit type that includes the page title (captured from the browser
 * tab) and tab metadata.
 */
export interface ExtendedPageVisit extends PageActivitySessionWithoutTree {
  /** Correlation token threaded through the pipeline for end-to-end tracing */
  visit_id: string;
  /** Page title, captured from the browser tab */
  title: string;
  /** Browser tab ID that opened this page */
  opener_tab_id?: number;
  /** Browser tab ID of this page */
  tab_id?: number;
}

/**
 * Configuration options for the visit queue processor
 */
export interface QueueProcessorConfig {
  /** Maximum number of visits to process in parallel */
  batch_size?: number;
  /** Milliseconds to wait before processing incomplete batch */
  batch_timeout?: number;
  /** Interval for retrying orphaned visits (milliseconds) */
  orphan_retry_interval?: number;
  /** Directory of the durable visit inbox; entries are removed once persisted to DuckDB */
  inbox_dir?: string;
}

/**
 * Result of inserting a page activity session
 */
interface InsertionResult {
  /** ID of the tree the visit was assigned to */
  tree_id: string | null;
  /** Whether the tree structure was modified */
  was_tree_changed: boolean;
  /** ID of the parent session this visit linked to, or null if it became a root (orphan). */
  referrer_session_id: string | null;
}

/**
 * Manages asynchronous batch processing of webpage visits.
 * 
 * Features:
 * - Batch processing for improved performance
 * - Orphaned visit handling for tabs opened from other tabs
 * - Automatic retry logic for failed processing
 * - Smart scheduling to optimize throughput
 * 
 * @example
 * ```typescript
 * const processor = new VisitQueueProcessor(
 *   duck_db,
 *   orphan_manager,
 *   { batch_size: 5, batch_timeout: 1000 }
 * );
 * 
 * // Add visits to the queue
 * processor.enqueue(visitData);
 * 
 * // Start processing (called automatically on enqueue)
 * processor.start();
 * 
 * // Stop processing
 * processor.stop();
 * ```
 */
export class VisitQueueProcessor {
  private request_queue: ExtendedPageVisit[] = [];
  private is_processing = false;
  private batch_timer: NodeJS.Timeout | null = null;
  private orphan_retry_timer: NodeJS.Timeout | null = null;
  
  // Configuration with defaults
  private readonly batch_size: number;
  private readonly batch_timeout: number;
  private readonly orphan_retry_interval: number;
  private readonly inbox_dir?: string;

  constructor(
    private readonly duck_db: DuckDB,
    private readonly orphan_manager: OrphanedVisitsManager,
    config: QueueProcessorConfig = {}
  ) {
    this.batch_size = config.batch_size ?? 3;
    this.batch_timeout = config.batch_timeout ?? 1000;
    this.orphan_retry_interval = config.orphan_retry_interval ?? 5000;
    this.inbox_dir = config.inbox_dir;
  }

  /**
   * Adds a webpage visit to the processing queue.
   * Automatically schedules batch processing if not already running.
   * 
   * @param visit - The webpage visit data to process
   * @returns Current queue position
   */
  enqueue(visit: ExtendedPageVisit): number {
    this.request_queue.push(visit);
    this.schedule_batch_processing();
    return this.request_queue.length;
  }

  /**
   * Adds multiple visits to the front of the queue for priority processing.
   * Used for re-queuing orphaned visits that now have their parent available.
   * 
   * @param visits - Array of visits to add to front of queue
   */
  enqueue_priority(visits: ExtendedPageVisit[]): void {
    this.request_queue.unshift(...visits);
    this.schedule_batch_processing();
  }

  /**
   * Drops every queued and orphan-parked visit the predicate matches — the
   * right-to-forget cascade calls this before deleting stored rows, so a
   * forgotten visit sitting in the in-memory pipeline cannot be re-inserted
   * after the forget. Matching visits' durable inbox files are removed by
   * the cascade's own file sweep.
   *
   * @returns How many in-memory visits were dropped
   */
  purge(matches: (visit: ExtendedPageVisit) => boolean): number {
    const before = this.request_queue.length;
    this.request_queue = this.request_queue.filter((visit) => !matches(visit));
    const dropped_from_queue = before - this.request_queue.length;
    const dropped_orphans = this.orphan_manager.purge((orphan) =>
      matches({ ...orphan.visit })
    );
    return dropped_from_queue + dropped_orphans;
  }

  /**
   * Starts the queue processor and orphan retry timer.
   */
  start(): void {
    this.reload_persisted_visits();
    this.start_orphan_retry_timer();
    this.schedule_batch_processing();
  }

  /**
   * Re-enqueues any visits left in the durable inbox by a previous run (e.g. the
   * extension restarted before they were written to DuckDB). Reprocessing is
   * safe: visit ids are deterministic, so insertion is idempotent.
   */
  private reload_persisted_visits(): void {
    if (!this.inbox_dir) return;
    const persisted = load_inbox(this.inbox_dir);
    if (persisted.length > 0) {
      console.log(`📥 Reloading ${persisted.length} visit(s) from the durable inbox`);
      this.request_queue.push(...persisted);
    }
  }

  /**
   * Stops all processing and clears timers.
   */
  stop(): void {
    if (this.batch_timer) {
      clearTimeout(this.batch_timer);
      this.batch_timer = null;
    }
    
    if (this.orphan_retry_timer) {
      clearInterval(this.orphan_retry_timer);
      this.orphan_retry_timer = null;
    }
  }

  /**
   * Gets current queue statistics.
   */
  get_stats(): {
    queue_length: number;
    is_processing: boolean;
    orphan_stats: ReturnType<OrphanedVisitsManager['get_stats']>;
  } {
    return {
      queue_length: this.request_queue.length,
      is_processing: this.is_processing,
      orphan_stats: this.orphan_manager.get_stats()
    };
  }

  /**
   * Determines if a visit is a potential orphan based on insertion results.
   * A visit is considered an orphan if it has an opener tab but no referrer parent was found.
   */
  private is_potential_orphan(
    visit: ExtendedPageVisit,
    inserted: InsertionResult
  ): boolean {
    return !!(
      visit.opener_tab_id &&
      inserted.tree_id &&
      !inserted.referrer_session_id
    );
  }

  /**
   * Handles a visit that appears to be orphaned (parent not yet processed).
   */
  private async handle_orphan_visit(
    visit: ExtendedPageVisit,
    opener_tab_id: number
  ): Promise<void> {
    console.log(
      `🚸 Detected potential orphan visit from tab ${visit.tab_id} with opener ${opener_tab_id}`
    );
    this.orphan_manager.add_orphan(visit, opener_tab_id);
  }

  /**
   * Processes a successfully inserted visit through the workflow.
   */
  private async handle_successful_visit(
    visit: ExtendedPageVisit,
    tree_id: string
  ): Promise<void> {
    const page_with_tree_id: PageActivitySession = {
      ...visit,
      tree_id,
    };

    await run_page_capture(this.duck_db, {
      new_page: page_with_tree_id,
      title: visit.title,
      visit_id: visit.visit_id,
    });

    // Process any orphaned children waiting for this page
    await this.process_orphaned_children(visit);
  }

  /**
   * Checks for and processes any orphaned visits waiting for this page.
   */
  private async process_orphaned_children(
    visit: ExtendedPageVisit
  ): Promise<void> {
    const tab_id = visit.tab_id;
    if (!tab_id) return;

    const orphans = this.orphan_manager.get_orphans_for_tab(tab_id);
    if (orphans.length === 0) return;

    console.log(
      `👨‍👧‍👦 Found ${orphans.length} orphaned children for tab ${tab_id}, re-queuing...`
    );

    // Re-queue orphaned children with updated parent reference
    const updated_visits = orphans.map(orphan => ({
      ...orphan.visit,
      referrer_page_session_id: visit.id,
    }));
    
    this.enqueue_priority(updated_visits);
    
    // Remove processed orphans
    this.orphan_manager.remove_orphans_for_tab(tab_id);
  }

  /**
   * Processes a single visit through the complete pipeline.
   *
   * @param visit - The visit to process.
   * @param park_if_orphan - When true (the default), an unresolved orphan is
   *   parked in the orphan manager. Retries pass false so the caller decides
   *   whether to keep the existing orphan entry, avoiding duplicate parking.
   * @returns true if the visit was processed (captured/dropped), false if it was parked as
   *   an orphan or made no progress.
   */
  async process_single_visit(
    visit: ExtendedPageVisit,
    { park_if_orphan = true }: { park_if_orphan?: boolean } = {}
  ): Promise<boolean> {
    const inserted = await insert_page_activity_session_with_tree_management(
      this.duck_db,
      visit
    );

    if (this.is_potential_orphan(visit, inserted)) {
      if (park_if_orphan) {
        await this.handle_orphan_visit(visit, visit.opener_tab_id!);
      }
      return false;
    }

    if (inserted.tree_id && inserted.was_tree_changed) {
      await this.handle_successful_visit(visit, inserted.tree_id);
      return true;
    }

    return false;
  }

  /**
   * Processes queued visits in batches for improved performance.
   */
  async process_queue(): Promise<void> {
    if (this.is_processing || this.request_queue.length === 0) return;

    this.is_processing = true;

    // Clear any pending batch timer since we're processing now
    if (this.batch_timer) {
      clearTimeout(this.batch_timer);
      this.batch_timer = null;
    }

    try {
      // Process items in batches for better performance
      const batch_size = Math.min(this.batch_size, this.request_queue.length);
      const batch = this.request_queue.splice(0, batch_size);

      console.log(`🚀 Processing batch of ${batch.length} page visits...`);

      // Process batch items in parallel for independent operations
      const batch_promises = batch.map(async (visit) => {
        try {
          const completed = await this.process_single_visit(visit);
          // Only drop the durable copy once the visit is fully processed. A
          // visit parked as an orphan still needs to survive a restart so it can
          // be re-linked to its parent and processed later.
          if (completed && this.inbox_dir) {
            remove_visit(this.inbox_dir, visit.id);
          }
        } catch (error) {
          record_outcome({
            visit_id: visit.visit_id,
            url: visit.url,
            decision: 'failed',
            error: format_error_detail(error),
          });
          // Leave the visit in the durable inbox so it is retried on restart.
        }
      });

      await Promise.allSettled(batch_promises);
      console.log(`✅ Completed batch processing`);
    } catch (error) {
      console.error("Error in batch processing:", error);
    } finally {
      this.is_processing = false;

      // Continue processing remaining items if any
      if (this.request_queue.length > 0) {
        // Use setTimeout to prevent stack overflow on large queues
        setTimeout(() => this.process_queue(), 0);
      }
    }
  }

  /**
   * Schedules batch processing with smart timing based on queue state.
   */
  private schedule_batch_processing(): void {
    if (this.batch_timer) return; // Timer already scheduled

    if (this.request_queue.length >= this.batch_size) {
      // Process immediately when we have a full batch
      this.process_queue();
    } else if (this.request_queue.length > 0) {
      // Schedule processing after timeout for partial batches
      this.batch_timer = setTimeout(() => {
        this.batch_timer = null;
        this.process_queue();
      }, this.batch_timeout);
    }
  }

  /**
   * Starts the timer for periodic orphan retry processing.
   */
  private start_orphan_retry_timer(): void {
    if (this.orphan_retry_timer) return; // Already running

    this.orphan_retry_timer = setInterval(() => {
      void this.retry_orphans();
    }, this.orphan_retry_interval);
  }

  /**
   * Re-attempts parked orphans whose parent may have arrived since.
   *
   * Each orphan is re-inserted (without re-parking): the tree-management layer
   * re-links it to its parent's tree if the parent is now present, in which case
   * the visit is processed and the orphan removed. Otherwise its retry count
   * advances and it is dropped once the ceiling is reached. Re-linking by parent
   * is what restores processing — the previous implementation re-queued the
   * raw orphan, which only re-parked it because the row already existed.
   */
  private async retry_orphans(): Promise<void> {
    const orphans = this.orphan_manager.get_orphans_for_retry();
    if (orphans.length === 0) return;

    console.log(`🔄 Retrying ${orphans.length} orphaned visits...`);

    for (const orphan of orphans) {
      const completed = await this.process_single_visit(orphan.visit, {
        park_if_orphan: false,
      });
      if (completed) {
        this.orphan_manager.remove_orphan(orphan);
        if (this.inbox_dir) {
          remove_visit(this.inbox_dir, orphan.visit.id);
        }
      } else {
        this.orphan_manager.increment_retry_count(orphan);
      }
    }
  }
}