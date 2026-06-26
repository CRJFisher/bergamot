// Run identity: the deterministic hashes that make a clustering run reproducible
// and idempotent (plan §8 "Run keying, idempotency, invalidation"). Pure and
// tf-free — it imports only node `crypto` and the config types, so it is safe to
// re-export from the index barrel (unlike cluster_window.ts / representations.ts,
// which pull the native TensorFlow chain).
//
// Three distinct hashes, each answering a different "did this change?" question:
//   - run_id            — the run's identity: window bounds + params + model +
//                         algo. A change here is a DIFFERENT run (supersede).
//   - input_fingerprint — the actual clustering inputs (which pages, at which
//                         vector version). A change here under the SAME run_id is
//                         data drift (re-embedding, or a late visit landing in a
//                         closed window) — an atomic replace, not a new run.
//   - cluster_id        — a cluster's identity within a run: hash(run_id|label).

import { createHash } from "crypto";
import type { HdbscanConfig, WindowConfig, PageVectorConfig } from "./config";

/**
 * Everything that rewrites the input vectors or the window boundaries but is NOT
 * already a separate column of the natural key (plan §8). Folded into
 * `params_hash` so that changing any of it produces a new `run_id`:
 *   - HDBSCAN params (min_cluster_size / min_samples / method / epsilon),
 *   - the page-vector POOLING strategy (segment/lead budgets, dispersion floor),
 *   - the WINDOWING policy (unit / max_samples / subdivide order / min visits) —
 *     not just the resolved bounds, which live in window_start/window_end,
 *   - the matryoshka dim (null in v1).
 *
 * The embedding model + dimension + page-representation-rule version are NOT here:
 * they are the separate `embedding_model_id` key column.
 */
export interface ResolvedParams {
  hdbscan: HdbscanConfig;
  window: WindowConfig;
  page_vector: PageVectorConfig;
  matryoshka_dim: number | null;
}

/** The natural key `run_id` hashes (plan §8). */
export interface RunNaturalKey {
  window_start: string; // ISO, inclusive (ACTUAL bounds used, incl. subdivision)
  window_end: string; // ISO, exclusive
  params_hash: string;
  embedding_model_id: string;
  algo_version: string;
}

/** One page's contribution to the input fingerprint. */
export interface FingerprintEntry {
  page_session_id: string;
  // A token that changes iff the page's stored vector changed — the
  // topic_page_vector freshness marker (its built_at, bumped on every re-embed).
  // Sourced by the caller; this module only needs it to be a stable per-vector id.
  embedding_vector_version: string;
}

function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, numbers via the
 * shortest round-trip form (so `0.1`, `0.10`, and `1e-1` serialize identically,
 * and `-0` collapses to `0`). This is the ONLY serializer used as a hash preimage;
 * two logically-identical values must produce byte-identical output.
 *
 * @throws if a number is non-finite (NaN/±Infinity) — `JSON.stringify` would
 *   silently emit `null`, corrupting the key. Fail loud instead.
 */
export function canonical_json(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonical_json: non-finite number ${value}`);
    }
    // JSON.stringify already yields the shortest round-trip decimal and renders
    // -0 as "0"; the finite guard above is the only behavior it lacks.
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonical_json).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonical_json(obj[k])}`)
      .join(",")}}`;
  }
  throw new Error(`canonical_json: unsupported value type ${typeof value}`);
}

/**
 * The forensic params string written to `topic_run.params_json` AND the preimage
 * of `params_hash` — one canonical form, so the stored JSON and the hash never
 * disagree.
 */
export function canonical_params_json(params: ResolvedParams): string {
  return canonical_json(params);
}

export function compute_params_hash(params: ResolvedParams): string {
  return sha256_hex(canonical_params_json(params));
}

/**
 * Normalize an ISO-8601 timestamp to a single canonical form (UTC, millisecond
 * precision, literal `Z`) so `2024-01-01T00:00:00Z` and `2024-01-01T00:00:00.000+00:00`
 * key identically. `Date` parsing is spec-guaranteed for ISO-8601.
 * @throws RangeError on an unparseable timestamp (fail loud).
 */
export function canonical_timestamp(iso: string): string {
  return new Date(iso).toISOString();
}

/** run_id = sha256 of the normalized natural key (plan §8). */
export function compute_run_id(key: RunNaturalKey): string {
  return sha256_hex(
    canonical_json({
      window_start: canonical_timestamp(key.window_start),
      window_end: canonical_timestamp(key.window_end),
      params_hash: key.params_hash,
      embedding_model_id: key.embedding_model_id,
      algo_version: key.algo_version,
    }),
  );
}

/** A cluster's identity within a run: hash(run_id | local_label). */
export function compute_cluster_id(run_id: string, local_label: number): string {
  return sha256_hex(`${run_id}|${local_label}`);
}

/**
 * input_fingerprint = sha256 of the sorted `(page_session_id, embedding_vector_version)`
 * pairs (plan §8). Order-independent by construction, so it depends only on WHICH
 * pages were clustered at WHICH vector version — detecting re-embedding (a version
 * bump) and late-arriving visits (an added pair) within an otherwise-unchanged run
 * key.
 */
export function compute_input_fingerprint(entries: FingerprintEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    if (a.page_session_id !== b.page_session_id) {
      return a.page_session_id < b.page_session_id ? -1 : 1;
    }
    if (a.embedding_vector_version === b.embedding_vector_version) return 0;
    return a.embedding_vector_version < b.embedding_vector_version ? -1 : 1;
  });
  return sha256_hex(
    canonical_json(
      sorted.map((e) => [e.page_session_id, e.embedding_vector_version]),
    ),
  );
}
