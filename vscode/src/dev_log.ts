/**
 * Dev-phase observability.
 *
 * Threads a single correlation `visit_id` through the capture pipeline
 * (browser → /visit → queue → workflow → store) and records:
 *  - structured stage events to a tail-able `<storage-base>/dev-log.jsonl`
 *  - the same events to a "Bergamot Dev Log" VS Code output channel (when
 *    running inside the extension host)
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
  // Browser-relayed stages (occur before the visit reaches the server).
  | 'capture_attempted'
  | 'capture_failed'
  // Server pipeline stages.
  | 'http_received'
  | 'parse_failed'
  | 'queued'
  | 'workflow_failed'
  | 'stored'
  | 'orphan_parked'
  | 'orphan_dropped';

/**
 * Stages a browser-relayed dev signal may carry. The browser side is untrusted
 * input, so the `/dev_signal` route validates against this set before logging.
 */
export const BROWSER_DEV_STAGES = [
  'capture_attempted',
  'capture_failed',
] as const;

export type BrowserDevStage = (typeof BROWSER_DEV_STAGES)[number];

export function is_browser_dev_stage(value: string): value is BrowserDevStage {
  return (BROWSER_DEV_STAGES as readonly string[]).includes(value);
}

export type VisitDecision =
  | 'stored'
  | 'failed'
  | 'orphan_parked'
  | 'orphan_dropped';

export interface VisitOutcome {
  visit_id: string;
  url: string;
  decision: VisitDecision;
  /** Drop cause for an orphan_dropped visit (`max_retries` or `expired`). */
  reason?: string;
  error?: string;
  at: string;
}

const MAX_RECENT_OUTCOMES = 100;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
// How often (in writes) to re-check the log size for rotation. Avoids a statSync
// on every append while still bounding growth within a long-running session.
const ROTATION_CHECK_INTERVAL = 200;

let channel: OutputChannelLike | undefined;
let log_file_path: string | undefined;
let enabled = false;
let writes_since_rotation_check = 0;
const recent_outcomes: VisitOutcome[] = [];

/** Maps a visit's terminal decision to its structured-log stage. */
const DECISION_TO_STAGE: Record<VisitDecision, DevLogStage> = {
  stored: 'stored',
  failed: 'workflow_failed',
  orphan_parked: 'orphan_parked',
  orphan_dropped: 'orphan_dropped',
};

function try_create_channel(): OutputChannelLike | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    return vscode.window.createOutputChannel('Bergamot Dev Log');
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
    // Periodically re-check the size so the file is rotated within a long
    // session, not only once at init.
    if (++writes_since_rotation_check >= ROTATION_CHECK_INTERVAL) {
      writes_since_rotation_check = 0;
      rotate_if_needed();
    }
  }
}

/**
 * Renders an unknown thrown value into a single log string that preserves as
 * much context as possible: the message, the full stack trace, and any nested
 * `cause` chain. Native `Error.stack` already begins with the message, so it is
 * preferred over `message` alone when present.
 */
export function format_error_detail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [error.stack ?? `${error.name}: ${error.message}`];
  let cause: unknown = (error as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    parts.push(`Caused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`);
    cause = (cause as { cause?: unknown }).cause;
  }
  if (cause !== undefined) parts.push(`Caused by: ${String(cause)}`);
  return parts.join('\n');
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
  dev_log(DECISION_TO_STAGE[outcome.decision], {
    visit_id: outcome.visit_id,
    url: outcome.url,
    reason: outcome.reason,
    error: outcome.error,
  });
}

export function get_recent_outcomes(): VisitOutcome[] {
  return [...recent_outcomes];
}

/**
 * Drops in-memory outcomes whose URL matches — called by the right-to-forget
 * cascade so a forgotten URL stops appearing in `Show Visit Outcomes`. The
 * ring is in-memory only; the on-disk dev-log.jsonl is a named plaintext
 * side-channel the cascade does not rewrite (see docs/threat-model.md).
 */
export function purge_outcomes(matches: (url: string) => boolean): void {
  for (let i = recent_outcomes.length - 1; i >= 0; i--) {
    if (matches(recent_outcomes[i].url)) {
      recent_outcomes.splice(i, 1);
    }
  }
}

/** Reveals the Bergamot Dev output channel, if running in the extension host. */
export function show_dev_log_channel(): void {
  channel?.show(true);
}
