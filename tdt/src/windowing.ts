/**
 * Windowing — pure function over (visits, config, range) → WindowSignal[].
 *
 * Window bounds are a pure function of (timestamps, config): identical inputs
 * yield byte-identical output. No I/O, no Date.now(), no randomness.
 *
 * Scale-check query: see DEFAULT_WINDOW_CONFIG in config.ts (plan §5).
 */

import type { WindowConfig } from "./config";
import type { VisitRow } from "./types";

export type WindowSignal =
  | { kind: "window"; start: string; end: string; visits: VisitRow[] }
  | { kind: "skip"; start: string; end: string; reason: "not_enough_data" };

// All ISO helpers operate on UTC epoch milliseconds (integers, no floats) to
// keep window bounds a byte-identical pure function of their inputs.

function parse_iso_ms(iso: string): number {
  const re =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|\+00:00)$/;
  const m = re.exec(iso);
  if (!m) {
    throw new Error(`parse_iso_ms: invalid or non-UTC ISO string: "${iso}"`);
  }
  const frac_ms = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], frac_ms);
}

function to_iso(ms: number): string {
  return new Date(ms).toISOString(); // always "YYYY-MM-DDTHH:mm:ss.SSSZ"
}

function month_start_ms(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

function add_months_ms(month_start: number, n: number): number {
  const d = new Date(month_start);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 0, 0, 0, 0);
}

function enumerate_calendar_windows(
  range_start: string,
  range_end: string,
  config: WindowConfig,
): { start_ms: number; end_ms: number }[] {
  const range_start_ms = parse_iso_ms(range_start);
  const range_end_ms = parse_iso_ms(range_end);
  if (range_start_ms >= range_end_ms) return [];

  const windows: { start_ms: number; end_ms: number }[] = [];

  if (config.unit === "month") {
    let cursor_ms = month_start_ms(range_start_ms);
    while (cursor_ms < range_end_ms) {
      const next_ms = add_months_ms(cursor_ms, 1);
      const w_start = Math.max(cursor_ms, range_start_ms);
      const w_end = Math.min(next_ms, range_end_ms);
      if (w_start < w_end) windows.push({ start_ms: w_start, end_ms: w_end });
      cursor_ms = next_ms;
    }
  } else {
    if (!config.days || config.days <= 0) {
      throw new Error(
        `enumerate_calendar_windows: config.unit is "days" but config.days is ${config.days}`,
      );
    }
    const stride_ms = config.days * 86_400_000;
    let cursor_ms = range_start_ms;
    while (cursor_ms < range_end_ms) {
      const w_end = Math.min(cursor_ms + stride_ms, range_end_ms);
      windows.push({ start_ms: cursor_ms, end_ms: w_end });
      cursor_ms += stride_ms;
    }
  }

  return windows;
}

// Returns the epoch-ms split point (= page_loaded_at of the right visit of the
// largest gap), or null when no gap exists (< 2 visits or all same timestamp).
// Equal-sized gaps tie-break to the lower right-visit ms; visits sharing a
// timestamp sort adjacently, so two distinct gaps can never share a right-visit
// ms and no further tie-break is reachable.
function find_largest_gap_ms(visits: VisitRow[]): number | null {
  if (visits.length < 2) return null;

  let best_gap = -1;
  let best_split_ms = -1;

  for (let i = 1; i < visits.length; i++) {
    const left_ms = parse_iso_ms(visits[i - 1].page_loaded_at);
    const right_ms = parse_iso_ms(visits[i].page_loaded_at);
    const gap = right_ms - left_ms;

    const beats =
      gap > best_gap || (gap === best_gap && right_ms < best_split_ms);

    if (beats) {
      best_gap = gap;
      best_split_ms = right_ms;
    }
  }

  if (best_gap <= 0) return null; // all visits at identical timestamp

  return best_split_ms;
}

// The split-point timestamp nearest the median visit by COUNT — the terminal
// bisection used once the calendar strategies are exhausted. Searching outward
// from the median index for the first boundary where the timestamp advances
// guarantees a balanced, non-degenerate split for any window that is not a single
// instant: it keeps every visit clustered (no shedding) and halves the count, so
// recursion depth is O(log n) and the O(n²) count guard is honored even for
// near-uniform browsing with no dominant gap. Returns null only when every visit
// shares one timestamp (genuinely unsplittable by time).
function median_split_ms(visits: VisitRow[]): number | null {
  const n = visits.length;
  if (n < 2) return null;
  const mid = n >> 1;
  for (let d = 0; d < n; d++) {
    for (const i of [mid - d, mid + d]) {
      if (i <= 0 || i >= n) continue;
      const left_ms = parse_iso_ms(visits[i - 1].page_loaded_at);
      const right_ms = parse_iso_ms(visits[i].page_loaded_at);
      if (right_ms > left_ms) return right_ms;
    }
  }
  return null;
}

// Returns ms of YYYY-MM-16T00:00:00.000Z for the month containing window_start_ms.
function half_month_split_ms(window_start_ms: number): number {
  const d = new Date(window_start_ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 16, 0, 0, 0, 0);
}

// Returns ms of the Monday 00:00:00.000Z of the ISO week containing the
// midpoint of [window_start_ms, window_end_ms).
function iso_week_split_ms(window_start_ms: number, window_end_ms: number): number {
  const mid_ms = Math.floor((window_start_ms + window_end_ms) / 2);
  const d = new Date(mid_ms);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const iso_dow = dow === 0 ? 7 : dow; // 1=Mon … 7=Sun
  const days_back = iso_dow - 1;
  const midnight_ms = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return midnight_ms - days_back * 86_400_000;
}

// A gap split is only "material progress" when each side keeps at least this
// share of the window's visits. Under near-uniform spacing the largest gap is no
// larger than the typical gap, so `find_largest_gap_ms` peels a single visit off
// the earliest of the equal-largest gaps; recursing on that 1-vs-rest split with
// the SAME strategy would peel one visit at a time — shedding most of a dense,
// steadily-browsed window as sub-min-visit skips and growing recursion depth to
// O(n). Requiring a balanced split makes a non-dominant gap fall through to
// calendar bisection (half_month → iso_week) instead, which both keeps the
// visits clustered and bounds recursion depth to O(log n). A genuine multi-burst
// window — dense bursts separated by large inter-burst gaps — still splits on the
// gap, because each burst clears the share floor.
const GAP_SPLIT_MIN_SHARE = 0.2;

function subdivide_window(
  start_ms: number,
  end_ms: number,
  visits: VisitRow[],
  config: WindowConfig,
  remaining_strategies: ReadonlyArray<"gap" | "half_month" | "iso_week">,
): WindowSignal[] {
  const start = to_iso(start_ms);
  const end = to_iso(end_ms);

  if (visits.length < config.min_window_visits) {
    return [{ kind: "skip", start, end, reason: "not_enough_data" }];
  }

  if (visits.length <= config.max_samples) {
    return [{ kind: "window", start, end, visits }];
  }

  if (remaining_strategies.length === 0) {
    // Named (calendar/gap) strategies exhausted. Bisect at the median visit by
    // count so the count guard is honored even when no calendar boundary or
    // dominant gap subdivides the window (e.g. near-uniform dense browsing).
    const mid_split = median_split_ms(visits);
    if (mid_split !== null) {
      const left = visits.filter(v => parse_iso_ms(v.page_loaded_at) < mid_split);
      const right = visits.filter(v => parse_iso_ms(v.page_loaded_at) >= mid_split);
      return [
        ...subdivide_window(start_ms, mid_split, left, config, remaining_strategies),
        ...subdivide_window(mid_split, end_ms, right, config, remaining_strategies),
      ];
    }
    // Genuinely unsplittable (every visit at one instant) — emit as-is.
    console.warn(
      `[tdt/windowing] ${start}/${end}: ${visits.length} visits exceed ` +
        `max_samples=${config.max_samples} but all subdivision strategies exhausted`,
    );
    return [{ kind: "window", start, end, visits }];
  }

  const strategy = remaining_strategies[0]!;
  // strategies_tail is passed on no-progress paths (null or degenerate split):
  // the list strictly shrinks, guaranteeing termination.
  // On a successful split, both children receive remaining_strategies so a
  // still-oversized half can retry the same strategy (e.g. gap-split a window
  // containing multiple dense bursts, each pair separated by a large gap).
  const strategies_tail = remaining_strategies.slice(1);

  let split_ms: number | null = null;

  if (strategy === "gap") {
    split_ms = find_largest_gap_ms(visits);
  } else if (strategy === "half_month") {
    const candidate = half_month_split_ms(start_ms);
    if (candidate > start_ms && candidate < end_ms) split_ms = candidate;
  } else if (strategy === "iso_week") {
    const candidate = iso_week_split_ms(start_ms, end_ms);
    if (candidate > start_ms && candidate < end_ms) split_ms = candidate;
  }

  if (split_ms === null) {
    return subdivide_window(start_ms, end_ms, visits, config, strategies_tail);
  }

  const left = visits.filter(v => parse_iso_ms(v.page_loaded_at) < split_ms!);
  const right = visits.filter(v => parse_iso_ms(v.page_loaded_at) >= split_ms!);

  // Degenerate split (one side empty) — advance to next strategy. A gap split
  // additionally requires both sides to clear GAP_SPLIT_MIN_SHARE: a non-dominant
  // gap (near-uniform spacing) that only peels a sliver off one end is not real
  // progress, so fall through to calendar bisection rather than peel one-by-one.
  const min_share =
    strategy === "gap"
      ? Math.min(left.length, right.length) >=
        GAP_SPLIT_MIN_SHARE * visits.length
      : true;
  if (left.length === 0 || right.length === 0 || !min_share) {
    return subdivide_window(start_ms, end_ms, visits, config, strategies_tail);
  }

  return [
    ...subdivide_window(start_ms, split_ms, left, config, remaining_strategies),
    ...subdivide_window(split_ms, end_ms, right, config, remaining_strategies),
  ];
}

/**
 * Slice a visit stream into window signals per config.
 *
 * @param visits - All fetched visits (any order; filtered and sorted internally).
 * @param config - Window + guard configuration.
 * @param range_start - ISO-8601 UTC, inclusive.
 * @param range_end   - ISO-8601 UTC, exclusive.
 */
export function compute_windows(
  visits: VisitRow[],
  config: WindowConfig,
  range_start: string,
  range_end: string,
): WindowSignal[] {
  const range_start_ms = parse_iso_ms(range_start);
  const range_end_ms = parse_iso_ms(range_end);
  if (range_start_ms >= range_end_ms) return [];

  const in_range = visits
    .filter(v => {
      const ms = parse_iso_ms(v.page_loaded_at);
      return ms >= range_start_ms && ms < range_end_ms;
    })
    .sort((a, b) => {
      const a_ms = parse_iso_ms(a.page_loaded_at);
      const b_ms = parse_iso_ms(b.page_loaded_at);
      if (a_ms !== b_ms) return a_ms - b_ms;
      return a.page_session_id < b.page_session_id
        ? -1
        : a.page_session_id > b.page_session_id
          ? 1
          : 0;
    });

  if (in_range.length === 0) return [];

  const calendar = enumerate_calendar_windows(range_start, range_end, config);
  const result: WindowSignal[] = [];

  for (const { start_ms, end_ms } of calendar) {
    const w_visits = in_range.filter(v => {
      const ms = parse_iso_ms(v.page_loaded_at);
      return ms >= start_ms && ms < end_ms;
    });
    result.push(...subdivide_window(start_ms, end_ms, w_visits, config, config.subdivide_order));
  }

  return result;
}
