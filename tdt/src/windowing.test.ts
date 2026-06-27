import { compute_windows, type WindowSignal } from "./windowing";
import { DEFAULT_WINDOW_CONFIG, type WindowConfig } from "./config";
import type { VisitRow } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function t(y: number, mo: number, d: number, h = 0, min = 0, s = 0, ms = 0): string {
  return new Date(Date.UTC(y, mo - 1, d, h, min, s, ms)).toISOString();
}

function make_visit(id: string, page_loaded_at: string): VisitRow {
  return {
    page_session_id: id,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    site_name: null,
    page_loaded_at,
    tree_id: `tree-${id}`,
  };
}

// Visits evenly spaced from start_ms, count total, step_ms apart.
function spaced_visits(
  prefix: string,
  start_iso: string,
  count: number,
  step_ms: number,
): VisitRow[] {
  const start_ms = new Date(start_iso).getTime();
  return Array.from({ length: count }, (_, i) =>
    make_visit(`${prefix}${i}`, new Date(start_ms + i * step_ms).toISOString()),
  );
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const MIN_CONFIG: WindowConfig = {
  ...DEFAULT_WINDOW_CONFIG,
  min_window_visits: 1,
};

// Small max_samples lets overflow fire without giant fixtures.
function overflow_config(max_samples: number): WindowConfig {
  return { ...MIN_CONFIG, max_samples };
}

// ---------------------------------------------------------------------------
// Calendar window generation
// ---------------------------------------------------------------------------

describe("compute_windows — calendar window generation", () => {
  it("generates UTC month windows aligned to calendar boundaries", () => {
    const jan_visits = spaced_visits("j", t(2026, 1, 5), 9, 3_600_000);
    const feb_visits = spaced_visits("f", t(2026, 2, 5), 10, 3_600_000);
    const result = compute_windows(
      [...jan_visits, ...feb_visits],
      DEFAULT_WINDOW_CONFIG,
      t(2026, 1, 1),
      t(2026, 3, 1),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      kind: "window",
      start: t(2026, 1, 1),
      end: t(2026, 2, 1),
    });
    expect(result[1]).toMatchObject({
      kind: "window",
      start: t(2026, 2, 1),
      end: t(2026, 3, 1),
    });
    const w0 = result[0] as Extract<WindowSignal, { kind: "window" }>;
    const w1 = result[1] as Extract<WindowSignal, { kind: "window" }>;
    expect(w0.visits).toHaveLength(9);
    expect(w1.visits).toHaveLength(10);
  });

  it("clamps first window start to range_start when mid-month", () => {
    const visits = spaced_visits("v", t(2026, 2, 12), 9, 3_600_000);
    const result = compute_windows(
      visits,
      DEFAULT_WINDOW_CONFIG,
      t(2026, 2, 10),
      t(2026, 3, 1),
    );
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(t(2026, 2, 10));
    expect(result[0].end).toBe(t(2026, 3, 1));
  });

  it("clamps last window end to range_end when mid-month", () => {
    const visits = spaced_visits("v", t(2026, 2, 3), 9, 3_600_000);
    const result = compute_windows(
      visits,
      DEFAULT_WINDOW_CONFIG,
      t(2026, 2, 1),
      t(2026, 2, 20),
    );
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(t(2026, 2, 1));
    expect(result[0].end).toBe(t(2026, 2, 20));
  });

  it("generates fixed-stride day windows anchored at range_start", () => {
    const config: WindowConfig = { ...MIN_CONFIG, unit: "days", days: 7 };
    const visits = [
      make_visit("a", t(2026, 1, 3)),
      make_visit("b", t(2026, 1, 10)),
      make_visit("c", t(2026, 1, 17)),
    ];
    const result = compute_windows(visits, config, t(2026, 1, 1), t(2026, 1, 22));

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ start: t(2026, 1, 1), end: t(2026, 1, 8) });
    expect(result[1]).toMatchObject({ start: t(2026, 1, 8), end: t(2026, 1, 15) });
    expect(result[2]).toMatchObject({ start: t(2026, 1, 15), end: t(2026, 1, 22) });
  });

  it("clamps the last day-stride window to range_end", () => {
    const config: WindowConfig = { ...MIN_CONFIG, unit: "days", days: 7 };
    // Visit in the second (partial) window [Jan 8, Jan 10).
    const visits = [make_visit("a", t(2026, 1, 9))];
    const result = compute_windows(visits, config, t(2026, 1, 1), t(2026, 1, 10));
    // [Jan 1, Jan 8): no visits → skip; [Jan 8, Jan 10): one visit → window, end clamped.
    const last = result[result.length - 1]!;
    expect(last.kind).toBe("window");
    expect(last.end).toBe(t(2026, 1, 10)); // clamped, not Jan 15
  });

  it("throws when unit=days but days is missing", () => {
    const config: WindowConfig = { ...MIN_CONFIG, unit: "days" };
    expect(() =>
      compute_windows([make_visit("a", t(2026, 1, 5))], config, t(2026, 1, 1), t(2026, 2, 1)),
    ).toThrow(/config\.days/);
  });

  it("returns empty array for equal range bounds", () => {
    const visits = [make_visit("a", t(2026, 1, 5))];
    expect(
      compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 1, 1)),
    ).toEqual([]);
  });

  it("returns empty array for inverted range (range_start > range_end)", () => {
    const visits = [make_visit("a", t(2026, 1, 5))];
    expect(
      compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 2, 1), t(2026, 1, 1)),
    ).toEqual([]);
  });

  it("throws when unit=days but days is zero", () => {
    const config: WindowConfig = { ...MIN_CONFIG, unit: "days", days: 0 };
    expect(() =>
      compute_windows([make_visit("a", t(2026, 1, 5))], config, t(2026, 1, 1), t(2026, 2, 1)),
    ).toThrow(/config\.days/);
  });

  it("returns empty array for empty visit list", () => {
    expect(
      compute_windows([], DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 3, 1)),
    ).toEqual([]);
  });

  it("includes visits at range_start and excludes visits at range_end", () => {
    const config: WindowConfig = { ...MIN_CONFIG };
    const visits = [
      make_visit("at_start", t(2026, 2, 1)),  // == range_start: included
      make_visit("inside", t(2026, 2, 15)),
      make_visit("at_end", t(2026, 3, 1)),    // == range_end: excluded
    ];
    const result = compute_windows(visits, config, t(2026, 2, 1), t(2026, 3, 1));
    expect(result).toHaveLength(1);
    const w = result[0] as Extract<WindowSignal, { kind: "window" }>;
    expect(w.visits.map(v => v.page_session_id)).toEqual(
      expect.arrayContaining(["at_start", "inside"]),
    );
    expect(w.visits.map(v => v.page_session_id)).not.toContain("at_end");
    expect(w.visits).toHaveLength(2);
  });

  it("excludes visits before range_start", () => {
    const config: WindowConfig = { ...MIN_CONFIG };
    const visits = [
      make_visit("before", t(2026, 1, 31)),   // before range
      make_visit("inside", t(2026, 2, 10)),
    ];
    const result = compute_windows(visits, config, t(2026, 2, 1), t(2026, 3, 1));
    const w = result[0] as Extract<WindowSignal, { kind: "window" }>;
    expect(w.visits.map(v => v.page_session_id)).toEqual(["inside"]);
  });

  it("sorts visits within a window by (page_loaded_at, page_session_id)", () => {
    const config: WindowConfig = { ...MIN_CONFIG };
    const same_ts = t(2026, 2, 10, 12, 0, 0);
    const visits = [
      make_visit("z", t(2026, 2, 10, 14, 0, 0)),
      make_visit("b", same_ts),
      make_visit("a", same_ts),
      make_visit("m", t(2026, 2, 10, 8, 0, 0)),
    ];
    const result = compute_windows(visits, config, t(2026, 2, 1), t(2026, 3, 1));
    const w = result[0] as Extract<WindowSignal, { kind: "window" }>;
    expect(w.visits.map(v => v.page_session_id)).toEqual(["m", "a", "b", "z"]);
  });
});

// ---------------------------------------------------------------------------
// Sparse window skip (AC #4)
// ---------------------------------------------------------------------------

describe("compute_windows — sparse window skip (AC #4)", () => {
  it("emits skip when visit count is below min_window_visits", () => {
    const visits = spaced_visits("v", t(2026, 1, 5), 5, 3_600_000); // 5 < 8
    const result = compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 2, 1));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "skip",
      start: t(2026, 1, 1),
      end: t(2026, 2, 1),
      reason: "not_enough_data",
    });
  });

  it("emits window at exactly min_window_visits (boundary, inclusive)", () => {
    const visits = spaced_visits("v", t(2026, 1, 5), 8, 3_600_000); // == 8
    const result = compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 2, 1));
    expect(result[0].kind).toBe("window");
  });

  it("emits skip at min_window_visits - 1 (boundary, exclusive)", () => {
    const visits = spaced_visits("v", t(2026, 1, 5), 7, 3_600_000); // == 7
    const result = compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 2, 1));
    expect(result[0].kind).toBe("skip");
  });

  it("preserves chronological order of mixed skip and window signals", () => {
    const jan = spaced_visits("j", t(2026, 1, 5), 5, 3_600_000); // skip
    const feb = spaced_visits("f", t(2026, 2, 5), 9, 3_600_000); // window
    const mar = spaced_visits("m", t(2026, 3, 5), 3, 3_600_000); // skip
    const result = compute_windows(
      [...jan, ...feb, ...mar],
      DEFAULT_WINDOW_CONFIG,
      t(2026, 1, 1),
      t(2026, 4, 1),
    );
    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe("skip");
    expect(result[1].kind).toBe("window");
    expect(result[2].kind).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// Count guard — no-split pass-through (AC #3)
// ---------------------------------------------------------------------------

describe("compute_windows — count guard (AC #3, no-split)", () => {
  it("passes window at exactly max_samples without splitting", () => {
    const cfg = overflow_config(6);
    const visits = spaced_visits("v", t(2026, 2, 3), 6, 3_600_000);
    const result = compute_windows(visits, cfg, t(2026, 2, 1), t(2026, 3, 1));
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("window");
    const w = result[0] as Extract<WindowSignal, { kind: "window" }>;
    expect(w.visits).toHaveLength(6);
  });

  it("triggers subdivision at max_samples + 1", () => {
    const cfg = overflow_config(6);
    const visits = spaced_visits("v", t(2026, 2, 3), 7, 3_600_000);
    const result = compute_windows(visits, cfg, t(2026, 2, 1), t(2026, 3, 1));
    expect(result.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Gap-split subdivision (AC #3)
// ---------------------------------------------------------------------------

describe("compute_windows — gap-split subdivision (AC #3)", () => {
  // Two tight bursts of 4 separated by a large gap, total 8 > max_samples=5.
  function two_burst_visits(): VisitRow[] {
    return [
      // Burst 1: Jan 3, hourly
      make_visit("a0", t(2026, 1, 3, 10)),
      make_visit("a1", t(2026, 1, 3, 11)),
      make_visit("a2", t(2026, 1, 3, 12)),
      make_visit("a3", t(2026, 1, 3, 13)),
      // Large gap (17 days)
      // Burst 2: Jan 20, hourly
      make_visit("b0", t(2026, 1, 20, 10)),
      make_visit("b1", t(2026, 1, 20, 11)),
      make_visit("b2", t(2026, 1, 20, 12)),
      make_visit("b3", t(2026, 1, 20, 13)),
    ];
  }

  it("splits at the largest inter-visit gap", () => {
    const cfg = overflow_config(5);
    const result = compute_windows(
      two_burst_visits(),
      cfg,
      t(2026, 1, 1),
      t(2026, 2, 1),
    );

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("window");
    expect(result[1].kind).toBe("window");
    const w0 = result[0] as Extract<WindowSignal, { kind: "window" }>;
    const w1 = result[1] as Extract<WindowSignal, { kind: "window" }>;
    expect(w0.visits).toHaveLength(4); // burst 1
    expect(w1.visits).toHaveLength(4); // burst 2
  });

  it("records actual gap-derived bounds, not calendar bounds (AC #3)", () => {
    const cfg = overflow_config(5);
    const result = compute_windows(
      two_burst_visits(),
      cfg,
      t(2026, 1, 1),
      t(2026, 2, 1),
    );

    // The split point must be b0's page_loaded_at (start of burst 2).
    const split = t(2026, 1, 20, 10);
    expect(result[0].end).toBe(split);
    expect(result[1].start).toBe(split);
    // Outer bounds are the calendar window bounds.
    expect(result[0].start).toBe(t(2026, 1, 1));
    expect(result[1].end).toBe(t(2026, 2, 1));
  });

  it("preserves all visits with no loss or duplication after split", () => {
    const cfg = overflow_config(5);
    const all = two_burst_visits();
    const result = compute_windows(all, cfg, t(2026, 1, 1), t(2026, 2, 1));

    const returned_ids = result.flatMap(s =>
      s.kind === "window" ? s.visits.map(v => v.page_session_id) : [],
    );
    const original_ids = all.map(v => v.page_session_id).sort();
    expect(returned_ids.sort()).toEqual(original_ids);
  });

  it("recurses: still-oversized half is gap-split again (gap strategy retries on sub-windows)", () => {
    // First gap split: largest gap is burst-a→burst-b (17d), splits at Jan 20.
    // Right half [Jan 20, Feb 1) = 9 visits > max_samples=5.
    // Because remaining_strategies is passed to successful split children (not tail),
    // gap retries on the right half: largest gap is burst-b→burst-c (8d), splits at Jan 28.
    const cfg = overflow_config(5);
    const visits = [
      ...spaced_visits("a", t(2026, 1, 3, 10), 4, 600_000),  // Jan 3 10:00–10:30 (4)
      // 17-day gap
      ...spaced_visits("b", t(2026, 1, 20, 10), 4, 600_000), // Jan 20 10:00–10:30 (4)
      // 8-day gap (past Jan 26 Monday boundary)
      ...spaced_visits("c", t(2026, 1, 28, 10), 5, 600_000), // Jan 28 10:00–10:40 (5)
    ];
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    // All sub-windows must be <= max_samples.
    const over = result.filter(s => s.kind === "window" && s.visits.length > 5);
    expect(over).toHaveLength(0);
    // All 13 visits accounted for.
    const ids = result.flatMap(s => (s.kind === "window" ? s.visits.map(v => v.page_session_id) : []));
    expect(ids).toHaveLength(13);
  });

  it("re-applies sparse check to gap-split sub-windows", () => {
    // 7 visits: 5 in burst-1, 2 trailing; max_samples=5; min_window_visits=3.
    const cfg: WindowConfig = { ...overflow_config(5), min_window_visits: 3 };
    const visits = [
      ...spaced_visits("a", t(2026, 1, 3, 10), 5, 600_000),
      // large gap
      make_visit("t0", t(2026, 1, 25, 10)),
      make_visit("t1", t(2026, 1, 25, 11)),
    ];
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    const kinds = result.map(s => s.kind);
    expect(kinds).toContain("window");  // the dense burst
    expect(kinds).toContain("skip");    // the 2-visit tail
  });

  it("when two gaps are equal-sized, picks the one with the lower right-visit timestamp", () => {
    // Gap v2→v3 (3 days) and gap v4→v5 (3 days) are tied.
    // Tie-break: lower right-visit timestamp wins → v3 (Jan 5+5d) beats v5 (Jan 5+9d).
    const base = t(2026, 1, 5);
    const DAY = 86_400_000;
    const visits = [
      make_visit("v0", new Date(new Date(base).getTime() + 0 * DAY).toISOString()),
      make_visit("v1", new Date(new Date(base).getTime() + 1 * DAY).toISOString()),
      make_visit("v2", new Date(new Date(base).getTime() + 2 * DAY).toISOString()),
      // 3-day gap; right visit = v3 (Jan 5+5d) — tied with v4→v5.
      make_visit("v3", new Date(new Date(base).getTime() + 5 * DAY).toISOString()),
      make_visit("v4", new Date(new Date(base).getTime() + 6 * DAY).toISOString()),
      // 3-day gap; right visit = v5 (Jan 5+9d) — higher right-visit ms, loses.
      make_visit("v5", new Date(new Date(base).getTime() + 9 * DAY).toISOString()),
    ];
    const cfg = overflow_config(3);
    const result1 = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    const result2 = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    // First split should be at v3 (lower right-visit ms wins the tie).
    expect(result1[0]!.end).toBe(visits[3]!.page_loaded_at);
  });

  it("splits cleanly when duplicate-timestamp visits straddle the gap boundary", () => {
    // Two visits share the pre-gap timestamp and two share the post-gap
    // timestamp. The gap's right visit is the first post-gap visit; both
    // duplicate-timestamp visits land in the same half (no visit is orphaned at
    // the boundary), and the result is deterministic.
    const DAY = 86_400_000;
    const base = new Date(t(2026, 1, 5)).getTime();
    const left_ts = new Date(base + 0 * DAY).toISOString();
    const right_ts = new Date(base + 4 * DAY).toISOString();
    const visits = [
      make_visit("L_a", left_ts),
      make_visit("L_b", left_ts),
      make_visit("R_z", right_ts),
      make_visit("R_m", right_ts),
    ];
    const cfg = overflow_config(2);
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    expect(result[0]!.end).toBe(right_ts);
    const w0 = result[0] as Extract<WindowSignal, { kind: "window" }>;
    expect(w0.visits.map(v => v.page_session_id).sort()).toEqual(["L_a", "L_b"]);
    const w1 = result[1] as Extract<WindowSignal, { kind: "window" }>;
    expect(w1.visits.map(v => v.page_session_id).sort()).toEqual(["R_m", "R_z"]);
  });
});

describe("compute_windows — uniform overflow does not degenerate", () => {
  // Regression: under near-uniform spacing the largest gap is no larger than the
  // typical gap, so gap-split would peel one visit off the earliest equal-largest
  // gap and recurse on the 1-vs-rest remainder — shedding most of a dense window
  // as sub-min-visit skips (and growing recursion depth to O(n)). The gap strategy
  // must instead fall through to calendar bisection so the visits stay clustered.
  it("keeps a dense uniform window's visits instead of peeling them off as skips", () => {
    const cfg: WindowConfig = {
      ...DEFAULT_WINDOW_CONFIG,
      max_samples: 100,
      // default subdivide_order ['gap','half_month','iso_week'] and min_window_visits.
    };
    // 300 evenly spaced visits across January (2h apart, all inside the month).
    const visits = spaced_visits("u", t(2026, 1, 3), 300, 7_200_000);
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));

    // No window exceeds the count guard.
    for (const s of result) {
      if (s.kind === "window") expect(s.visits.length).toBeLessThanOrEqual(100);
    }
    // Every visit is retained in a real window — none shed as single-visit skips.
    const retained = result.flatMap(s =>
      s.kind === "window" ? s.visits.map(v => v.page_session_id) : [],
    );
    expect(retained.sort()).toEqual(visits.map(v => v.page_session_id).sort());
    // Calendar bisection yields a handful of balanced windows, not ~200 skips.
    expect(result.every(s => s.kind === "window")).toBe(true);
    expect(result.length).toBeLessThan(20);
  });

  it("still gap-splits a genuine multi-burst window (dominant gaps survive the share floor)", () => {
    // Two dense bursts of 60, separated by a 20-day gap, total 120 > max_samples=100.
    const cfg: WindowConfig = { ...DEFAULT_WINDOW_CONFIG, max_samples: 100 };
    const visits = [
      ...spaced_visits("a", t(2026, 1, 3, 0), 60, 600_000),
      ...spaced_visits("b", t(2026, 1, 23, 0), 60, 600_000),
    ];
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    // The dominant inter-burst gap splits into the two 60-visit bursts.
    const sizes = result
      .filter(s => s.kind === "window")
      .map(s => (s as Extract<WindowSignal, { kind: "window" }>).visits.length)
      .sort((a, b) => a - b);
    expect(sizes).toEqual([60, 60]);
  });
});

// ---------------------------------------------------------------------------
// Calendar bisection fallback (AC #3)
// ---------------------------------------------------------------------------

describe("compute_windows — calendar bisection fallback (AC #3)", () => {
  it("falls back to half_month when gap strategy is not in subdivide_order", () => {
    // Only half_month strategy: split must be at day 16, not a gap-derived point.
    const cfg: WindowConfig = {
      ...overflow_config(5),
      subdivide_order: ["half_month", "iso_week"],
    };
    const visits = [
      ...spaced_visits("a", t(2026, 1, 3), 3, 3_600_000),  // early Jan
      ...spaced_visits("b", t(2026, 1, 20), 4, 3_600_000), // late Jan
    ];
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    const split = "2026-01-16T00:00:00.000Z";
    expect(result.some(s => s.start === split || s.end === split)).toBe(true);
  });

  it("iso_week split lands on a Monday", () => {
    const cfg: WindowConfig = {
      ...overflow_config(3),
      subdivide_order: ["iso_week"],
    };
    // 6 visits spread across Jan; iso_week split at Monday near midpoint.
    const visits = spaced_visits("v", t(2026, 1, 5), 6, 86_400_000 * 3);
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));

    // Find the interior split boundary.
    const splits = new Set<string>();
    for (const s of result) {
      if (s.start !== t(2026, 1, 1)) splits.add(s.start);
      if (s.end !== t(2026, 2, 1)) splits.add(s.end);
    }

    for (const split_iso of splits) {
      const d = new Date(split_iso);
      expect(d.getUTCDay()).toBe(1); // Monday
    }
  });

  it("emits window and warns when all strategies exhausted but window still over max", () => {
    // All visits at the same timestamp → gap=0 → no split; half_month/iso_week
    // split would be outside a tiny window → no split; exhausted.
    const cfg: WindowConfig = {
      ...overflow_config(3),
      min_window_visits: 1,
      subdivide_order: ["gap", "half_month", "iso_week"],
    };
    const same_ts = t(2026, 1, 10, 12);
    const visits = Array.from({ length: 5 }, (_, i) =>
      make_visit(`v${i}`, same_ts),
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = compute_windows(visits, cfg, t(2026, 1, 1), t(2026, 2, 1));
    expect(warn).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("window");
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Determinism (AC #2, AC #5)
// ---------------------------------------------------------------------------

describe("compute_windows — determinism (AC #2, AC #5)", () => {
  it("produces byte-identical output on two calls with identical input", () => {
    const visits = [
      ...spaced_visits("j", t(2026, 1, 5), 5, 3_600_000),    // sparse (skip)
      ...spaced_visits("f", t(2026, 2, 5), 9, 3_600_000),    // window
      ...spaced_visits("m", t(2026, 3, 5), 3, 3_600_000),    // sparse (skip)
    ];
    const r1 = compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 4, 1));
    const r2 = compute_windows(visits, DEFAULT_WINDOW_CONFIG, t(2026, 1, 1), t(2026, 4, 1));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("is invariant to input visit ordering", () => {
    const ordered = spaced_visits("v", t(2026, 2, 1), 9, 3_600_000);
    const shuffled = [...ordered].reverse();
    const r_ordered = compute_windows(
      ordered,
      DEFAULT_WINDOW_CONFIG,
      t(2026, 2, 1),
      t(2026, 3, 1),
    );
    const r_shuffled = compute_windows(
      shuffled,
      DEFAULT_WINDOW_CONFIG,
      t(2026, 2, 1),
      t(2026, 3, 1),
    );
    expect(JSON.stringify(r_ordered)).toBe(JSON.stringify(r_shuffled));
  });

  it("accepts +00:00 offset timestamps as equivalent to Z", () => {
    const config: WindowConfig = { ...MIN_CONFIG };
    const visits = [make_visit("x", "2026-02-10T12:00:00+00:00")];
    const result = compute_windows(visits, config, t(2026, 2, 1), t(2026, 3, 1));
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("window");
    const w = result[0] as Extract<WindowSignal, { kind: "window" }>;
    expect(w.visits[0]!.page_session_id).toBe("x");
  });

  it("throws for non-UTC offset timestamps in visit data", () => {
    const config: WindowConfig = { ...MIN_CONFIG };
    const visits = [make_visit("bad", "2026-02-10T12:00:00+01:00")];
    expect(() =>
      compute_windows(visits, config, t(2026, 2, 1), t(2026, 3, 1)),
    ).toThrow(/non-UTC/);
  });

  it("throws for malformed timestamps in visit data", () => {
    const config: WindowConfig = { ...MIN_CONFIG };
    const visits = [make_visit("bad", "not-a-date")];
    expect(() =>
      compute_windows(visits, config, t(2026, 2, 1), t(2026, 3, 1)),
    ).toThrow(/invalid or non-UTC/);
  });
});
