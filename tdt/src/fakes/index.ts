import type { RelationalReader, EmbedFn, VectorStore, ClusterSink } from "../ports";
import type { VisitRow, RunRecord, ClusterRecord, MemberRecord } from "../types";

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
      v[d] = (state / 0xffffffff) * 2 - 1; // [-1, 1]
      if (v[d] !== 0) nonzero = true;
    }
    if (!nonzero) v[0] = 1; // never an all-zero (un-normalizable) vector
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

/** In-memory ClusterSink. Records every write for test assertions. */
export class FakeClusterSink implements ClusterSink {
  readonly written_runs: RunRecord[] = [];
  readonly written_clusters: ClusterRecord[] = [];
  readonly written_members: MemberRecord[] = [];

  async write_run(run: RunRecord): Promise<void> {
    this.written_runs.push(run);
  }

  async write_clusters(clusters: ClusterRecord[]): Promise<void> {
    this.written_clusters.push(...clusters);
  }

  async write_members(members: MemberRecord[]): Promise<void> {
    this.written_members.push(...members);
  }
}
