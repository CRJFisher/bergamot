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
