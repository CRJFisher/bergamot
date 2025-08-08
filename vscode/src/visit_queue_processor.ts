/**
 * Visit Queue Processor
 * 
 * Handles asynchronous batch processing of webpage visits with retry logic,
 * orphan handling, and performance optimizations.
 */

import { DuckDB, get_page_sessions_with_tree_id } from "./duck_db";
import { LanceDBMemoryStore } from "./lance_db";
import { 
  PageActivitySessionWithoutTreeOrContent,
  PageActivitySession
} from "./duck_db_models";
import { OrphanedVisitsManager, OrphanedVisit } from "./orphaned_visits";
import { insert_page_activity_session_with_tree_management } from "./webpage_tree";
import { run_workflow } from "./reconcile_webpage_trees_workflow_vanilla";

/**
 * Extended visit type that includes raw content and tab metadata
 */
export interface ExtendedPageVisit extends PageActivitySessionWithoutTreeOrContent {
  /** Raw HTML content of the page */
  raw_content: string;
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
}

/**
 * Result of inserting a page activity session
 */
interface InsertionResult {
  /** ID of the tree the visit was assigned to */
  tree_id: string | null;
  /** Whether the tree structure was modified */
  was_tree_changed: boolean;
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
 *   duckDb,
 *   memoryDb,
 *   workflowApp,
 *   orphanManager,
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

  constructor(
    private readonly duck_db: DuckDB,
    private readonly memory_db: LanceDBMemoryStore,
    private readonly webpage_categoriser_app: any, // Workflow app type
    private readonly orphan_manager: OrphanedVisitsManager,
    config: QueueProcessorConfig = {}
  ) {
    this.batch_size = config.batch_size ?? 3;
    this.batch_timeout = config.batch_timeout ?? 1000;
    this.orphan_retry_interval = config.orphan_retry_interval ?? 5000;
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
   * Starts the queue processor and orphan retry timer.
   */
  start(): void {
    this.start_orphan_retry_timer();
    this.schedule_batch_processing();
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
      !visit.referrer_page_session_id
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
    const tree_members = await get_page_sessions_with_tree_id(
      this.duck_db,
      this.memory_db,
      tree_id
    );
    
    const page_with_tree_id: PageActivitySession = {
      ...visit,
      tree_id,
      content: visit.raw_content
    };
    
    await run_workflow(
      {
        members: tree_members,
        new_page: page_with_tree_id,
        raw_content: visit.raw_content,
      },
      this.webpage_categoriser_app,
      this.duck_db
    );

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
   */
  async process_single_visit(visit: ExtendedPageVisit): Promise<void> {
    const inserted = await insert_page_activity_session_with_tree_management(
      this.duck_db,
      visit
    );

    if (this.is_potential_orphan(visit, inserted)) {
      await this.handle_orphan_visit(visit, visit.opener_tab_id!);
    } else if (inserted.tree_id && inserted.was_tree_changed) {
      await this.handle_successful_visit(visit, inserted.tree_id);
    }
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
          await this.process_single_visit(visit);
        } catch (error) {
          console.error(
            `Error processing page visit ${visit.url}:`,
            error
          );
          // Continue processing other items even if one fails
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
      const orphans = this.orphan_manager.get_orphans_for_retry();
      if (orphans.length > 0) {
        console.log(`🔄 Retrying ${orphans.length} orphaned visits...`);
        
        for (const orphan of orphans) {
          this.orphan_manager.increment_retry_count(orphan);
          this.request_queue.push(orphan.visit);
        }
        
        this.schedule_batch_processing();
      }
    }, this.orphan_retry_interval);
  }
}