import { DuckDB } from "../duck_db";
import { PageActivitySessionWithoutContent } from "../duck_db_models";
import { evaluate_page_gate } from "./page_gate";
import { record_gate_decision } from "./gate_metrics";
import { dev_log, record_outcome } from "../dev_log";
import { store_capture } from "./store_capture";

/**
 * Immutable dependencies for the capture pipeline. A plain struct, not a
 * stateful class — the pipeline is a function, not an object.
 */
export interface CaptureDeps {
  duck_db: DuckDB;
}

export interface CaptureInputs {
  new_page: PageActivitySessionWithoutContent;
  raw_content: string;
  visit_id?: string;
}

/**
 * The capture pipeline. For each visit it runs the capture gate (`page_gate`),
 * and for kept pages stores the raw page zstd-compressed via `store_capture`
 * (which also reads cheap `<head>` metadata with `read_metadata`) in DuckDB.
 * Interpretation — main-content extraction, chunking, embedding, summarisation —
 * is handled by the RAG-prep pipeline (task-31), which reads the stored raw page
 * on demand. Tree linking happens upstream in the visit queue (`webpage_tree`)
 * before this runs.
 */
export async function run_page_capture(
  deps: CaptureDeps,
  inputs: CaptureInputs
): Promise<void> {
  const visit_id = inputs.visit_id ?? inputs.new_page.id;

  // Capture gate: keep everything except transient interstitials
  // (empty / auth / redirect).
  const gate = evaluate_page_gate(inputs.raw_content, inputs.new_page.url);
  dev_log("gate_result", {
    visit_id,
    url: inputs.new_page.url,
    keep: gate.keep,
  });
  record_gate_decision(gate);

  if (!gate.keep) {
    record_outcome({
      visit_id,
      url: inputs.new_page.url,
      decision: "dropped",
      reason: gate.reason,
    });
    return;
  }

  // Capture-first: the raw page is the durable, lossless source of truth. Any
  // failure propagates to the visit queue, which records the terminal `failed`
  // outcome and decides whether to retry.
  const capture = await store_capture(deps.duck_db, {
    page_session_id: inputs.new_page.id,
    url: inputs.new_page.url,
    html: inputs.raw_content,
    content_type: "text/html",
    captured_at: new Date().toISOString(),
  });

  record_outcome({
    visit_id,
    url: inputs.new_page.url,
    decision: "stored",
    byte_size: capture.original_byte_size,
  });
}
