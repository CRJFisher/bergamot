/**
 * Process-wide counters for the capture gate: how many pages were captured vs
 * dropped, and a tally of drop causes. Surfaced by the
 * `bergamot.showCaptureMetrics` command.
 *
 * Modelled as a module-level accumulator with functions (not a stateful class),
 * per the project's no-stateful-classes rule.
 */
import { GateDecision } from "./page_gate";

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

/** Records a single capture-gate decision. */
export function record_gate_decision(decision: GateDecision): void {
  metrics.total_pages++;
  if (decision.keep) {
    metrics.captured_pages++;
  } else {
    metrics.dropped_pages++;
    metrics.drop_reasons[decision.reason] =
      (metrics.drop_reasons[decision.reason] || 0) + 1;
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
