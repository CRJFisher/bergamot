import {
  record_gate_decision,
  get_gate_metrics,
  reset_gate_metrics,
} from "./gate_metrics";

describe("gate_metrics accumulator", () => {
  beforeEach(() => {
    reset_gate_metrics();
  });

  it("starts empty", () => {
    expect(get_gate_metrics()).toEqual({
      total_pages: 0,
      captured_pages: 0,
      dropped_pages: 0,
      drop_reasons: {},
    });
  });

  it("counts captured vs dropped and tallies drop reasons", () => {
    record_gate_decision({ keep: true });
    record_gate_decision({ keep: false, reason: "auth" });
    record_gate_decision({ keep: false, reason: "auth" });
    record_gate_decision({ keep: false, reason: "redirect" });

    expect(get_gate_metrics()).toEqual({
      total_pages: 4,
      captured_pages: 1,
      dropped_pages: 3,
      drop_reasons: { auth: 2, redirect: 1 },
    });
  });

  it("returns an isolated snapshot that does not mutate as more are recorded", () => {
    record_gate_decision({ keep: false, reason: "auth" });
    const snapshot = get_gate_metrics();
    record_gate_decision({ keep: false, reason: "auth" });

    expect(snapshot.total_pages).toBe(1);
    expect(snapshot.drop_reasons).toEqual({ auth: 1 });
    expect(get_gate_metrics().total_pages).toBe(2);
  });
});
