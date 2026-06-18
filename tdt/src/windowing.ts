/**
 * Windowing — pure function over (visits, config, range) → WindowSignal[].
 *
 * Window bounds are a pure function of (timestamps, config): identical inputs
 * yield byte-identical output. No I/O, no Date.now(), no randomness.
 *
 * Scale-check query (plan §5, "Empirical prerequisite"). Run through the
 * extension's HTTP broker (the DB is encrypted at rest and held read-write by
 * the extension — it cannot be opened directly from the CLI):
 *
 *   SELECT date_trunc('month', CAST(page_loaded_at AS TIMESTAMP)) AS wk,
 *          count(*) AS visits
 *   FROM webpage_activity_sessions
 *   GROUP BY 1 ORDER BY 2 DESC LIMIT 24;
 *
 * Decision recorded in TASK-36.2 Implementation Notes (AC #1).
 */

import type { WindowConfig } from "./config";
import type { VisitRow } from "./types";

export type WindowSignal =
  | { kind: "window"; start: string; end: string; visits: VisitRow[] }
  | { kind: "skip"; start: string; end: string; reason: "not_enough_data" };

// ---------------------------------------------------------------------------
// ISO helpers — all operate on UTC epoch milliseconds (integers, no floats).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Calendar window enumeration
// ---------------------------------------------------------------------------

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
    // unit === "days"
    if (!config.days || config.days <= 0) {
      throw new Error(
        `compute_windows: config.unit is "days" but config.days is ${config.days}`,
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

// ---------------------------------------------------------------------------
// Subdivision helpers
// ---------------------------------------------------------------------------

// Returns the epoch-ms split point (= page_loaded_at of the right visit of the
// largest gap), or null when no gap exists (< 2 visits or all same timestamp).
// Tie-break: lower right-visit page_loaded_at ms, then lower page_session_id.
function find_largest_gap_ms(visits: VisitRow[]): number | null {
  if (visits.length < 2) return null;

  let best_gap = -1;
  let best_split_ms = -1;
  let best_right_psid = "";

  for (let i = 1; i < visits.length; i++) {
    const left_ms = parse_iso_ms(visits[i - 1].page_loaded_at);
    const right_ms = parse_iso_ms(visits[i].page_loaded_at);
    const gap = right_ms - left_ms;
    const psid = visits[i].page_session_id;

    const beats =
      gap > best_gap ||
      (gap === best_gap && right_ms < best_split_ms) ||
      (gap === best_gap && right_ms === best_split_ms && psid < best_right_psid);

    if (beats) {
      best_gap = gap;
      best_split_ms = right_ms;
      best_right_psid = psid;
    }
  }

  if (best_gap <= 0) return null; // all visits at identical timestamp

  return best_split_ms;
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

// ---------------------------------------------------------------------------
// Core recursion
// ---------------------------------------------------------------------------

function emit_window(
  start_ms: number,
  end_ms: number,
  visits: VisitRow[],
  config: WindowConfig,
  remaining: ReadonlyArray<"gap" | "half_month" | "iso_week">,
): WindowSignal[] {
  const start = to_iso(start_ms);
  const end = to_iso(end_ms);

  if (visits.length < config.min_window_visits) {
    return [{ kind: "skip", start, end, reason: "not_enough_data" }];
  }

  if (visits.length <= config.max_samples) {
    return [{ kind: "window", start, end, visits }];
  }

  // Overflow: try next strategy.
  if (remaining.length === 0) {
    // All strategies exhausted — emit as-is to guarantee termination.
    console.warn(
      `[tdt/windowing] ${start}/${end}: ${visits.length} visits exceed ` +
        `max_samples=${config.max_samples} but all subdivision strategies exhausted`,
    );
    return [{ kind: "window", start, end, visits }];
  }

  const strategy = remaining[0]!;
  const tail = remaining.slice(1);

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
    return emit_window(start_ms, end_ms, visits, config, tail);
  }

  const left = visits.filter(v => parse_iso_ms(v.page_loaded_at) < split_ms!);
  const right = visits.filter(v => parse_iso_ms(v.page_loaded_at) >= split_ms!);

  // Degenerate split (one side empty) — advance to next strategy.
  if (left.length === 0 || right.length === 0) {
    return emit_window(start_ms, end_ms, visits, config, tail);
  }

  return [
    ...emit_window(start_ms, split_ms, left, config, tail),
    ...emit_window(split_ms, end_ms, right, config, tail),
  ];
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

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
    result.push(...emit_window(start_ms, end_ms, w_visits, config, config.subdivide_order));
  }

  return result;
}
