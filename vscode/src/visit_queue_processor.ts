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

export interface ExtendedPageVisit extends PageActivitySessionWithoutTree {
  /** Correlation token threaded through the pipeline for end-to-end tracing */
  visit_id: string;
  title: string;
  opener_tab_id?: number;
  tab_id?: number;
}

/**
 * Narrows an unknown value — typically JSON deserialized from the durable inbox
 * or the replay ring — to a complete {@link ExtendedPageVisit}.
 *
 * The capture pipeline binds every field to DuckDB, which rejects `undefined`
 * with an opaque `Cannot create values of type ANY` error. A persisted entry
 * written by an earlier capture model can be missing required fields (notably
 * `title`), so callers validate before feeding a visit into the pipeline and
 * drop anything that fails rather than letting it detonate at the DB bind.
 */
export function is_complete_visit(value: unknown): value is ExtendedPageVisit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.url === "string" &&
    typeof v.page_loaded_at === "string" &&
    typeof v.visit_id === "string" &&
    typeof v.title === "string"
  );
}

export interface QueueProcessorConfig {
  /** Maximum number of visits to process in parallel */
  batch_size?: number;
  /** Milliseconds to wait before processing an incomplete batch */
  batch_timeout?: number;
  /** Interval for retrying orphaned visits (milliseconds) */
  orphan_retry_interval?: number;
  /** Directory of the durable visit inbox; entries are removed once persisted to DuckDB */
  inbox_dir?: string;
  /**
   * Called with the `page_session_id` of each visit the moment its metadata is
   * captured. The server wires this to an eager re-download, so a page's public
   * content is fetched and cached as it is captured rather than lazily on first
   * read. Fire-and-forget by contract — the queue never awaits it, so a slow or
   * failing re-download cannot stall capture throughput.
   */
  on_captured?: (page_session_id: string) => void;
}

interface InsertionResult {
  tree_id: string | null;
  was_tree_changed: boolean;
  /** ID of the parent session this visit linked to, or null if it became a root (orphan). */
  referrer_session_id: string | null;
}

export class VisitQueueProcessor {
  private request_queue: ExtendedPageVisit[] = [];
  private is_processing = false;
  private batch_timer: NodeJS.Timeout | null = null;
  private orphan_retry_timer: NodeJS.Timeout | null = null;

  private readonly batch_size: number;
  private readonly batch_timeout: number;
  private readonly orphan_retry_interval: number;
  private readonly inbox_dir?: string;
  private readonly on_captured?: (page_session_id: string) => void;

  constructor(
    private readonly duck_db: DuckDB,
    private readonly orphan_manager: OrphanedVisitsManager,
    config: QueueProcessorConfig = {}
  ) {
    this.batch_size = config.batch_size ?? 3;
    this.batch_timeout = config.batch_timeout ?? 1000;
    this.orphan_retry_interval = config.orphan_retry_interval ?? 5000;
    this.inbox_dir = config.inbox_dir;
    this.on_captured = config.on_captured;
  }

  /** @returns the resulting queue length */
  enqueue(visit: ExtendedPageVisit): number {
    this.request_queue.push(visit);
    this.schedule_batch_processing();
    return this.request_queue.length;
  }

  /**
   * Adds visits to the front of the queue so re-queued orphans, which now have a
   * resolvable parent, are processed ahead of newly arriving visits.
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
   * A visit is a potential orphan when it was opened from another tab yet the
   * insert found no referrer parent — its opener has not been captured yet.
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

  private async handle_orphan_visit(
    visit: ExtendedPageVisit,
    opener_tab_id: number
  ): Promise<void> {
    console.log(
      `🚸 Detected potential orphan visit from tab ${visit.tab_id} with opener ${opener_tab_id}`
    );
    this.orphan_manager.add_orphan(visit, opener_tab_id);
  }

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

    // Fire only after the metadata row is committed, so the re-download corpus
    // can resolve against page_session_id (=== the visit id).
    this.on_captured?.(page_with_tree_id.id);

    await this.process_orphaned_children(visit);
  }

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

    const updated_visits = orphans.map(orphan => ({
      ...orphan.visit,
      referrer_page_session_id: visit.id,
    }));

    this.enqueue_priority(updated_visits);
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

  async process_queue(): Promise<void> {
    if (this.is_processing || this.request_queue.length === 0) return;

    this.is_processing = true;

    if (this.batch_timer) {
      clearTimeout(this.batch_timer);
      this.batch_timer = null;
    }

    try {
      const batch_size = Math.min(this.batch_size, this.request_queue.length);
      const batch = this.request_queue.splice(0, batch_size);

      console.log(`🚀 Processing batch of ${batch.length} page visits...`);

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

      if (this.request_queue.length > 0) {
        // Yield to the event loop between batches to avoid unbounded recursion
        // on a large queue.
        setTimeout(() => this.process_queue(), 0);
      }
    }
  }

  private schedule_batch_processing(): void {
    if (this.batch_timer) return;

    if (this.request_queue.length >= this.batch_size) {
      this.process_queue();
    } else if (this.request_queue.length > 0) {
      this.batch_timer = setTimeout(() => {
        this.batch_timer = null;
        this.process_queue();
      }, this.batch_timeout);
    }
  }

  private start_orphan_retry_timer(): void {
    if (this.orphan_retry_timer) return;

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
   * advances and it is dropped once the ceiling is reached. Re-inserting (rather
   * than re-enqueuing the raw orphan) is essential — re-enqueuing would only
   * re-park it, since its row already exists and the parent link is what unblocks
   * processing.
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