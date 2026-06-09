/**
 * Polite-egress scheduling for re-download. Re-downloading pages the user already
 * visited is a personal-archive activity, not crawling, but it still reaches out
 * to third-party servers — so it is rate-limited per host, capped in global
 * concurrency, and backs off on transient failures.
 *
 * The gate is a generic async scheduler: it knows nothing about browsers or fetch
 * outcomes. The fetcher hands it `(host, task)` pairs and a retry predicate.
 */

export interface PolitenessConfig {
  /** Max re-downloads in flight at once across all hosts. */
  max_global_concurrency: number;
  /** Max simultaneous re-downloads to a single host. */
  max_host_concurrency: number;
  /** Minimum gap between the end of one fetch to a host and the next start. */
  per_host_min_interval_ms: number;
  /** Retry attempts after the first try, for transient failures only. */
  max_retries: number;
  /** Base backoff; attempt N waits `base * 2**N` (capped, jittered). */
  backoff_base_ms: number;
  /** Upper bound on a single backoff delay. */
  backoff_max_ms: number;
  /** Fraction of the backoff delay that is randomized away, to de-sync retries. */
  jitter_ratio: number;
}

/** Default polite-egress policy: gentle on a laptop, gentle on the remote host. */
export const POLITENESS: PolitenessConfig = {
  max_global_concurrency: 2,
  max_host_concurrency: 1,
  per_host_min_interval_ms: 2000,
  max_retries: 3,
  backoff_base_ms: 1000,
  backoff_max_ms: 30000,
  jitter_ratio: 0.3,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

interface HostState {
  in_flight: number;
  next_allowed_at: number;
}

interface Waiter {
  host: string;
  run: () => void;
}

export class PolitenessGate {
  private global_in_flight = 0;
  private readonly host_state = new Map<string, HostState>();
  private readonly queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly config: PolitenessConfig = POLITENESS) {}

  /**
   * Runs `task` under the global/per-host concurrency caps and per-host interval.
   * Resolves/rejects with the task's own result; scheduling never alters it.
   */
  schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        host,
        run: () => {
          this.acquire(host);
          task().then(
            (value) => {
              this.release(host);
              resolve(value);
            },
            (error) => {
              this.release(host);
              reject(error);
            }
          );
        },
      });
      this.pump();
    });
  }

  /**
   * Runs `task` through {@link schedule}, retrying while `should_retry` holds and
   * attempts remain. `retry_after_ms` lets a result (e.g. a 429 with a
   * `Retry-After`) override the computed backoff for the next wait.
   */
  async with_retry<T>(
    host: string,
    task: () => Promise<T>,
    should_retry: (result: T) => boolean,
    retry_after_ms?: (result: T) => number | null
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      const result = await this.schedule(host, task);
      if (attempt >= this.config.max_retries || !should_retry(result)) {
        return result;
      }
      const override = retry_after_ms ? retry_after_ms(result) : null;
      await sleep(override ?? this.backoff_delay(attempt));
      attempt++;
    }
  }

  /** Backoff for the given zero-based attempt: exponential, capped, jittered. */
  private backoff_delay(attempt: number): number {
    const raw = this.config.backoff_base_ms * 2 ** attempt;
    const capped = Math.min(raw, this.config.backoff_max_ms);
    return capped * (1 - this.config.jitter_ratio * Math.random());
  }

  private state(host: string): HostState {
    let state = this.host_state.get(host);
    if (!state) {
      state = { in_flight: 0, next_allowed_at: 0 };
      this.host_state.set(host, state);
    }
    return state;
  }

  private acquire(host: string): void {
    this.global_in_flight++;
    this.state(host).in_flight++;
  }

  private release(host: string): void {
    this.global_in_flight--;
    const state = this.state(host);
    state.in_flight--;
    state.next_allowed_at = Date.now() + this.config.per_host_min_interval_ms;
    this.pump();
  }

  /**
   * Starts every queued task that currently has a slot. A task blocked only by
   * its host's interval does not block tasks for other hosts; the soonest such
   * interval schedules a re-pump.
   */
  private pump(): void {
    const now = Date.now();
    let earliest_wait = Infinity;

    for (let i = 0; i < this.queue.length; ) {
      if (this.global_in_flight >= this.config.max_global_concurrency) break;
      const waiter = this.queue[i];
      const state = this.state(waiter.host);

      if (state.in_flight >= this.config.max_host_concurrency) {
        i++;
        continue;
      }
      if (now < state.next_allowed_at) {
        earliest_wait = Math.min(earliest_wait, state.next_allowed_at - now);
        i++;
        continue;
      }

      this.queue.splice(i, 1);
      waiter.run();
    }

    if (
      this.global_in_flight < this.config.max_global_concurrency &&
      this.queue.length > 0 &&
      earliest_wait !== Infinity
    ) {
      this.schedule_pump(earliest_wait);
    }
  }

  private schedule_pump(delay: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, delay));
    // Don't let a pending re-pump keep the process alive on shutdown.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
}
