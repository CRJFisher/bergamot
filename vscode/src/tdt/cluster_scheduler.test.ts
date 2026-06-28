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

  it("clamps a sub-hourly cadence to the minimum so a misconfig cannot busy-loop", async () => {
    let runs = 0;
    const scheduler = new ClusterScheduler({
      run: async () => {
        runs++;
      },
      cadence_hours: () => 0.001, // 3.6s configured; floor is one hour
      now: () => new Date(),
      initial_delay_ms: 0,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1); // catch-up tick

    // Advancing well past the configured 3.6s but short of the clamp floor must
    // not fire a second tick.
    await jest.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(runs).toBe(1);

    await jest.advanceTimersByTimeAsync(60 * 1000); // reaches the one-hour floor
    expect(runs).toBe(2);

    scheduler.dispose();
  });

  it("re-reads the cadence each cycle so a settings change takes effect without reload", async () => {
    let runs = 0;
    // Widen the cadence the moment the catch-up tick runs; its finally re-reads
    // the value and must arm the next tick at the new interval, not the old one.
    let cadence = 1;
    const scheduler = new ClusterScheduler({
      run: async () => {
        runs++;
        cadence = 2;
      },
      cadence_hours: () => cadence,
      now: () => new Date(),
      initial_delay_ms: 0,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // the old 1h must not fire
    expect(runs).toBe(1);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // the new 2h elapses
    expect(runs).toBe(2);

    scheduler.dispose();
  });

  it("clusters the window from the start of the previous month through now", async () => {
    const specs: WindowSpec[] = [];
    const scheduler = new ClusterScheduler({
      run: async (spec) => {
        specs.push(spec);
      },
      cadence_hours: () => 24,
      now: () => new Date("2026-06-26T12:30:00.000Z"),
      initial_delay_ms: 0,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(specs).toEqual([
      {
        range_start: "2026-05-01T00:00:00.000Z",
        range_end: "2026-06-26T12:30:00.000Z",
      },
    ]);

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
