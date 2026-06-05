/**
 * Process-wide counters for the deterministic capture gate: how many pages were
 * captured vs dropped, and a tally of drop reasons. Surfaced by the
 * `bergamot.showCaptureMetrics` command. No page-type/confidence tracking — the
 * gate is usage-agnostic and makes no LLM classification.
 *
 * Modelled as a module-level accumulator with functions (not a stateful class),
 * per the project's no-stateful-classes rule.
 */
export interface GateMetrics {
  total_pages: number;
  captured_pages: number;
  dropped_pages: number;
  drop_reasons: Record<string, number>;
}

let metrics: GateMetrics = empty_metrics();

function empty_metrics(): GateMetrics {
  return {
    total_pages: 0,
    captured_pages: 0,
    dropped_pages: 0,
    drop_reasons: {},
  };
}

/** Records a single gate decision. `reason` is the drop cause when dropped. */
export function record_gate_decision(captured: boolean, reason?: string): void {
  metrics.total_pages++;
  if (captured) {
    metrics.captured_pages++;
  } else {
    metrics.dropped_pages++;
    if (reason) {
      metrics.drop_reasons[reason] = (metrics.drop_reasons[reason] || 0) + 1;
    }
  }
}

/** Returns a snapshot of the current gate metrics. */
export function get_gate_metrics(): GateMetrics {
  return { ...metrics, drop_reasons: { ...metrics.drop_reasons } };
}

/** Resets the counters (used by tests). */
export function reset_gate_metrics(): void {
  metrics = empty_metrics();
}
