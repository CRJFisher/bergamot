/**
 * Dev-phase observability.
 *
 * Threads a single correlation `visit_id` through the capture pipeline
 * (browser → /visit → queue → workflow → store) and records:
 *  - structured stage events to a tail-able `<storage-base>/dev-log.jsonl`
 *  - the same events to a "Bergamot Dev" VS Code output channel (when running
 *    inside the extension host)
 *  - a per-visit outcome ring buffer surfaced by `bergamot.showVisitOutcomes`
 *
 * Logging is gated (see {@link init_dev_log}) and the JSONL file is rotated at a
 * size cap so it never grows unbounded.
 *
 * The `vscode` module is loaded lazily so this file is safe to import from a
 * headless Node process (the standalone server/E2E harness), where only the
 * JSONL sink is active.
 */

import * as fs from 'fs';
import * as path from 'path';

// Minimal shape we use from the VS Code output channel, so the lazy require
// does not drag in `@types/vscode` typing at the value level.
interface OutputChannelLike {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
  clear(): void;
}

export type DevLogStage =
  | 'http_received'
  | 'parse_failed'
  | 'decompress_failed'
  | 'queued'
  | 'classify_result'
  | 'dropped'
  | 'workflow_failed'
  | 'stored'
  | 'orphan_parked'
  | 'orphan_dropped';

export type VisitDecision =
  | 'stored'
  | 'dropped'
  | 'failed'
  | 'orphan_parked'
  | 'orphan_dropped';

export interface VisitOutcome {
  visit_id: string;
  url: string;
  page_type?: string;
  confidence?: number;
  decision: VisitDecision;
  reason?: string;
  error?: string;
  at: string;
}

const MAX_RECENT_OUTCOMES = 100;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let channel: OutputChannelLike | undefined;
let log_file_path: string | undefined;
let enabled = false;
const recent_outcomes: VisitOutcome[] = [];

function try_create_channel(): OutputChannelLike | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    return vscode.window.createOutputChannel('Bergamot Dev');
  } catch {
    // Headless (no extension host) — JSONL sink only.
    return undefined;
  }
}

function rotate_if_needed(): void {
  if (!log_file_path) return;
  try {
    const stat = fs.statSync(log_file_path);
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(log_file_path, `${log_file_path}.1`);
    }
  } catch {
    // No existing file — nothing to rotate.
  }
}

/**
 * Initializes dev logging. Call once during activation (and from the headless
 * entrypoint). When `is_enabled` is false the output channel is still created
 * but no events are written, so the channel can be inspected without cost.
 */
export function init_dev_log(storage_base: string, is_enabled: boolean): void {
  enabled = is_enabled;
  if (!channel) {
    channel = try_create_channel();
  }
  log_file_path = path.join(storage_base, 'dev-log.jsonl');
  if (enabled) {
    rotate_if_needed();
  }
}

export function is_dev_log_enabled(): boolean {
  return enabled;
}

/**
 * Records a structured pipeline-stage event. Cheap and non-blocking: the JSONL
 * append is async so the hot path (e.g. the `/visit` 200) is never blocked.
 */
export function dev_log(stage: DevLogStage, fields: Record<string, unknown>): void {
  if (!enabled) return;
  const entry = { ts: new Date().toISOString(), stage, ...fields };
  const line = JSON.stringify(entry);
  channel?.appendLine(line);
  if (log_file_path) {
    fs.appendFile(log_file_path, line + '\n', () => {
      /* best-effort: a failed dev-log write must never break the pipeline */
    });
  }
}

/**
 * Records the terminal outcome of a visit (stored / dropped / failed / orphan).
 * Kept in a bounded in-memory ring buffer for `bergamot.showVisitOutcomes` and
 * also emitted to the structured log.
 */
export function record_outcome(outcome: Omit<VisitOutcome, 'at'>): void {
  const full: VisitOutcome = { ...outcome, at: new Date().toISOString() };
  recent_outcomes.unshift(full);
  if (recent_outcomes.length > MAX_RECENT_OUTCOMES) {
    recent_outcomes.length = MAX_RECENT_OUTCOMES;
  }
  dev_log(
    outcome.decision === 'stored'
      ? 'stored'
      : outcome.decision === 'failed'
        ? 'workflow_failed'
        : outcome.decision === 'orphan_parked'
          ? 'orphan_parked'
          : outcome.decision === 'orphan_dropped'
            ? 'orphan_dropped'
            : 'dropped',
    {
      visit_id: outcome.visit_id,
      url: outcome.url,
      page_type: outcome.page_type,
      confidence: outcome.confidence,
      reason: outcome.reason,
      error: outcome.error,
    }
  );
}

export function get_recent_outcomes(): VisitOutcome[] {
  return [...recent_outcomes];
}

/** Reveals the Bergamot Dev output channel, if running in the extension host. */
export function show_dev_log_channel(): void {
  channel?.show(true);
}
