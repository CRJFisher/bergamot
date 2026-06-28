import type { RelationalReader, EmbedFn, VectorStore, ClusterSink } from "../ports";
import type {
  VisitRow,
  RunRecord,
  ClusterRecord,
  MemberRecord,
  RunBundle,
  PersistResult,
} from "../types";

/**
 * In-memory RelationalReader. Returns all seeded visits ignoring window bounds
 * (windowed selection is the production reader's job; fixtures here are
 * already window-scoped by the test).
 */
export class FakeRelationalReader implements RelationalReader {
  constructor(private readonly visits: VisitRow[] = []) {}

  async list_visits_in_window(
    _start: string,
    _end: string,
  ): Promise<VisitRow[]> {
    return [...this.visits];
  }
}

/**
 * In-memory EmbedFn factory. Returns a unit vector (first component 1, rest 0)
 * so the result is already L2-normalized and downstream L2-normalization is a
 * no-op. Records every embedded text for test assertions.
 */
export function create_fake_embed(dim = 8): {
  embed: EmbedFn;
  embedded_texts: string[];
} {
  const embedded_texts: string[] = [];
  const embed: EmbedFn = async (text: string) => {
    embedded_texts.push(text);
    const v = new Float32Array(dim);
    v[0] = 1;
    return v;
  };
  return { embed, embedded_texts };
}

/**
 * Content-dependent EmbedFn: maps each distinct text to a stable, non-zero
 * direction via a pure FNV-1a → LCG fill (no call counter, no clock — the vector
 * is a function of `text` alone). Same text → byte-identical vector; different
 * text → different direction. Exercises pooling / dispersion / determinism that
 * the constant {@link create_fake_embed} cannot. Records every embedded text.
 */
export function create_deterministic_embed(dim = 8): {
  embed: EmbedFn;
  embedded_texts: string[];
} {
  const embedded_texts: string[] = [];
  const embed: EmbedFn = async (text: string) => {
    embedded_texts.push(text);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    let state = (h ^ 0x9e3779b9) >>> 0;
    const v = new Float32Array(dim);
    let nonzero = false;
    for (let d = 0; d < dim; d++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      v[d] = (state / 0xffffffff) * 2 - 1;
      if (v[d] !== 0) nonzero = true;
    }
    if (!nonzero) v[0] = 1; // an all-zero vector is un-normalizable downstream
    return v;
  };
  return { embed, embedded_texts };
}

/** In-memory VectorStore keyed by `${page_session_id}:${embedding_model_id}`. */
export class FakeVectorStore implements VectorStore {
  private readonly store = new Map<string, Float32Array>();

  private key(page_session_id: string, embedding_model_id: string): string {
    return `${page_session_id}:${embedding_model_id}`;
  }

  async get(
    page_session_id: string,
    embedding_model_id: string,
  ): Promise<Float32Array | null> {
    return this.store.get(this.key(page_session_id, embedding_model_id)) ?? null;
  }

  async put(
    page_session_id: string,
    embedding_model_id: string,
    _repr: string,
    vector: Float32Array,
  ): Promise<void> {
    this.store.set(this.key(page_session_id, embedding_model_id), vector);
  }
}

/**
 * In-memory ClusterSink that faithfully models the no-op / atomic-replace /
 * supersede decision (plan §8), so library-level idempotency tests run without
 * DuckDB. A fake that merely recorded the last bundle would let an idempotency
 * bug pass; the authoritative version is the production ClusterStore test against
 * real DuckDB, and this mirror must agree with it.
 */
export class FakeClusterSink implements ClusterSink {
  /** Holds both live and superseded runs; status distinguishes them. */
  readonly runs = new Map<string, RunRecord>();
  readonly clusters = new Map<string, ClusterRecord[]>();
  readonly members = new Map<string, MemberRecord[]>();
  readonly results: PersistResult[] = [];

  async persist(bundle: RunBundle): Promise<PersistResult> {
    const { run } = bundle;
    const existing = this.runs.get(run.id);

    if (
      existing &&
      existing.status === "complete" &&
      existing.input_fingerprint === run.input_fingerprint
    ) {
      const result: PersistResult = {
        run_id: run.id,
        outcome: "noop",
        superseded_run_ids: [],
      };
      this.results.push(result);
      return result;
    }

    const outcome: PersistResult["outcome"] = existing ? "replaced" : "created";

    // Supersede every OTHER live run for this window — on BOTH the replace and
    // create paths, exactly as the production ClusterStore does — so that after
    // any persist exactly one `complete` run survives for the window. (Replace
    // normally finds none, but re-running a previously-superseded key must retire
    // whatever is currently live for the window.)
    const superseded_run_ids: string[] = [];
    for (const other of this.runs.values()) {
      if (
        other.status === "complete" &&
        other.id !== run.id &&
        other.window_start === run.window_start &&
        other.window_end === run.window_end
      ) {
        other.status = "superseded";
        superseded_run_ids.push(other.id);
      }
    }

    this.runs.set(run.id, { ...run });
    this.clusters.set(run.id, [...bundle.clusters]);
    this.members.set(run.id, [...bundle.members]);

    const result: PersistResult = {
      run_id: run.id,
      outcome,
      superseded_run_ids,
    };
    this.results.push(result);
    return result;
  }
}
