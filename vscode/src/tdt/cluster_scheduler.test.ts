import { ClusterScheduler } from "./cluster_scheduler";
import type { WindowSpec } from "./rebuild_clusters";

// Fake timers, but advanced with the ASYNC API so each fired tick's awaited
// `run` callback (and the `finally` re-arm) settle before assertions. Plain
// advanceTimersByTime would fire the timer but not drain the run's microtasks.
describe("ClusterScheduler", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fires a catch-up tick after activation, then re-arms at the cadence (AC #5)", async () => {
    const specs: WindowSpec[] = [];
    const scheduler = new ClusterScheduler({
      run: async (spec) => {
        specs.push(spec);
      },
      cadence_hours: () => 24,
      now: () => new Date("2026-06-26T00:00:00.000Z"),
      initial_delay_ms: 1000,
    });

    scheduler.start();
    expect(specs).toHaveLength(0); // not before the catch-up delay

    await jest.advanceTimersByTimeAsync(1000);
    expect(specs).toHaveLength(1); // catch-up tick

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(specs).toHaveLength(2); // re-armed at the daily cadence

    scheduler.dispose();
  });

  it("never overlaps runs: the next tick is armed only after the current settles (AC #5)", async () => {
    let active = 0;
    let max_active = 0;
    let release: () => void = () => undefined;

    const scheduler = new ClusterScheduler({
      run: async () => {
        active++;
        max_active = Math.max(max_active, active);
        await new Promise<void>((r) => (release = r));
        active--;
      },
      cadence_hours: () => 1,
      now: () => new Date(),
      initial_delay_ms: 0,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    // First tick is in flight; advancing the clock must NOT start a second.
    await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
    expect(max_active).toBe(1);

    release();
    await Promise.resolve();
    scheduler.dispose();
  });

  it("stops re-arming when the cadence is set to 0 (automatic run disabled)", async () => {
    let runs = 0;
    const scheduler = new ClusterScheduler({
      run: async () => {
        runs++;
      },
      cadence_hours: () => 0,
      now: () => new Date(),
      initial_delay_ms: 0,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1); // the catch-up tick still runs

    await jest.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000);
    expect(runs).toBe(1); // but no further runs are armed

    scheduler.dispose();
  });

  it("survives a run failure and re-arms the next tick", async () => {
    let runs = 0;
    const errors: unknown[] = [];
    const scheduler = new ClusterScheduler({
      run: async () => {
        runs++;
        throw new Error("boom");
      },
      cadence_hours: () => 1,
      now: () => new Date(),
      on_error: (e) => errors.push(e),
      initial_delay_ms: 0,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    expect(errors).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(runs).toBe(2); // the failure did not kill the schedule

    scheduler.dispose();
  });

  it("dispose() prevents any further tick", async () => {
    let runs = 0;
    const scheduler = new ClusterScheduler({
      run: async () => {
        runs++;
      },
      cadence_hours: () => 1,
      now: () => new Date(),
      initial_delay_ms: 1000,
    });

    scheduler.start();
    scheduler.dispose();
    await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
    expect(runs).toBe(0);
  });
});
