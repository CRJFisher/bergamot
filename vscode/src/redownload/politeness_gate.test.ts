import { PolitenessGate, PolitenessConfig } from "./politeness_gate";

const FAST: PolitenessConfig = {
  max_global_concurrency: 2,
  max_host_concurrency: 1,
  per_host_min_interval_ms: 60,
  max_retries: 3,
  backoff_base_ms: 10,
  backoff_max_ms: 40,
  jitter_ratio: 0,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("PolitenessGate", () => {
  it("never runs two tasks for the same host at once", async () => {
    const gate = new PolitenessGate(FAST);
    let concurrent = 0;
    let max_concurrent = 0;
    const task = async () => {
      concurrent++;
      max_concurrent = Math.max(max_concurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
    };
    await Promise.all([
      gate.schedule("a.com", task),
      gate.schedule("a.com", task),
      gate.schedule("a.com", task),
    ]);
    expect(max_concurrent).toBe(1);
  });

  it("caps global concurrency across hosts", async () => {
    const gate = new PolitenessGate({ ...FAST, per_host_min_interval_ms: 0 });
    let concurrent = 0;
    let max_concurrent = 0;
    const task = async () => {
      concurrent++;
      max_concurrent = Math.max(max_concurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
    };
    await Promise.all(
      ["a.com", "b.com", "c.com", "d.com"].map((h) => gate.schedule(h, task))
    );
    expect(max_concurrent).toBeLessThanOrEqual(2);
  });

  it("enforces the per-host minimum interval between fetches", async () => {
    const gate = new PolitenessGate(FAST);
    const starts: number[] = [];
    const task = async () => {
      starts.push(Date.now());
    };
    await gate.schedule("a.com", task);
    await gate.schedule("a.com", task);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(FAST.per_host_min_interval_ms - 15);
  });

  it("does not let a throttled host block a different host", async () => {
    const gate = new PolitenessGate({ ...FAST, per_host_min_interval_ms: 500 });
    const a1 = deferred();
    await gate.schedule("a.com", async () => {
      /* immediately done; host a now throttled for 500ms */
    });
    let b_ran = false;
    const b = gate.schedule("b.com", async () => {
      b_ran = true;
      a1.resolve();
    });
    // queue another a.com fetch that is throttled
    gate.schedule("a.com", async () => {});
    await b;
    expect(b_ran).toBe(true);
  });

  it("retries a transient failure up to max_retries then returns the last result", async () => {
    const gate = new PolitenessGate(FAST);
    let attempts = 0;
    const result = await gate.with_retry(
      "a.com",
      async () => {
        attempts++;
        return { ok: false };
      },
      (r) => !r.ok
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(FAST.max_retries + 1); // first try + retries
  });

  it("stops retrying as soon as the result is acceptable", async () => {
    const gate = new PolitenessGate(FAST);
    let attempts = 0;
    const result = await gate.with_retry(
      "a.com",
      async () => {
        attempts++;
        return { ok: attempts >= 2 };
      },
      (r) => !r.ok
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it("honors a retry_after override for the next wait", async () => {
    const gate = new PolitenessGate({ ...FAST, per_host_min_interval_ms: 0 });
    let attempts = 0;
    const t0 = Date.now();
    await gate.with_retry(
      "a.com",
      async () => {
        attempts++;
        return { ok: attempts >= 2, retry_after: 50 };
      },
      (r) => !r.ok,
      (r) => r.retry_after
    );
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
  });
});
