import { single_flight, SingleFlightHolder } from "./single_flight";

/** A promise whose resolution the test controls. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("single_flight", () => {
  it("coalesces concurrent calls onto one operation run", async () => {
    const holder: SingleFlightHolder<number> = {};
    let runs = 0;
    const gate = deferred<number>();
    const op = () => {
      runs++;
      return gate.promise;
    };

    const a = single_flight(holder, op);
    const b = single_flight(holder, op);
    expect(runs).toBe(1); // second call joined the first
    expect(a).toBe(b); // same promise instance

    gate.resolve(42);
    expect(await a).toBe(42);
    expect(await b).toBe(42);
  });

  it("clears the latch after success so a later call starts fresh", async () => {
    const holder: SingleFlightHolder<number> = {};
    let runs = 0;
    const op = async () => {
      runs++;
      return runs;
    };

    expect(await single_flight(holder, op)).toBe(1);
    expect(await single_flight(holder, op)).toBe(2); // new run, not the cached promise
    expect(runs).toBe(2);
  });

  it("clears the latch after failure and propagates the rejection", async () => {
    const holder: SingleFlightHolder<number> = {};
    let runs = 0;
    const op = async () => {
      runs++;
      if (runs === 1) throw new Error("boom");
      return runs;
    };

    await expect(single_flight(holder, op)).rejects.toThrow("boom");
    // The latch cleared, so the next call runs again (does not wedge).
    expect(await single_flight(holder, op)).toBe(2);
    expect(runs).toBe(2);
  });
});
