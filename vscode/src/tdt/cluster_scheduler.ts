/**
 * The automatic in-host clustering scheduler (TASK-36.9, plan §11 step 9) — the
 * passive-product path: Bergamot surfaces the projects a user is working on
 * without them remembering to run anything. It is a VS Code extension timer, NOT
 * an OS cron + headless writer: a headless writer would violate the single-writer
 * model (plan §3), so the trigger lives inside the one process that owns the DB.
 *
 * It fires the SAME `rebuild_clusters` entry the manual command does, on a
 * configurable cadence (default once/day). Quiet-day ticks are ~free: §8
 * idempotency makes a run over an unchanged window a no-op (no re-download, no
 * re-fit). Duplicate concurrent runs are prevented two ways — the scheduler waits
 * for each tick to settle before scheduling the next (no self-overlap), and the
 * shared single-flight inside `run` coalesces a tick that races the manual
 * command; cross-window/process duplication is caught by the single-writer DB +
 * idempotency (AC #5).
 *
 * Count-based triggers ("fire after N visits") are explicitly out of scope — the
 * count guard is a windowing-quality invariant (TASK-36.2), not a trigger.
 */
import { default_window_spec, type WindowSpec } from "./rebuild_clusters";

/** Floor on the resolved cadence — a misconfigured tiny value must not busy-loop
 *  the trigger; re-download is politeness-gated, so sub-hourly buys nothing. */
const MIN_CADENCE_MS = 60 * 60 * 1000;

/** Catch-up delay after activation before the first tick, so clustering never
 *  competes with extension startup or the first capture. */
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;

export interface ClusterSchedulerOptions {
  /** Run one clustering pass over `spec` (single-flighted by the server). */
  run: (spec: WindowSpec) => Promise<unknown>;
  /** The configured cadence in hours, re-read each cycle so a settings change
   *  takes effect without reload. `<= 0` disables the automatic run. */
  cadence_hours: () => number;
  /** Wall-clock; injected for testability. */
  now: () => Date;
  /** Surfaced on a tick failure (a run error must not kill the schedule). */
  on_error?: (error: unknown) => void;
  /** Override the post-activation catch-up delay (tests). */
  initial_delay_ms?: number;
}

export class ClusterScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: ClusterSchedulerOptions) {}

  /** Arm the catch-up tick; each tick re-arms the next at the current cadence. */
  start(): void {
    this.arm(this.options.initial_delay_ms ?? DEFAULT_INITIAL_DELAY_MS);
  }

  private arm(delay_ms: number): void {
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay_ms);
  }

  private async tick(): Promise<void> {
    try {
      await this.options.run(default_window_spec(this.options.now()));
    } catch (error) {
      this.options.on_error?.(error);
    } finally {
      // Re-read the cadence each cycle. `<= 0` disables further runs (the user
      // turned the automatic trigger off); a manual command still works.
      const hours = this.options.cadence_hours();
      if (hours > 0) {
        this.arm(Math.max(MIN_CADENCE_MS, hours * 60 * 60 * 1000));
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
