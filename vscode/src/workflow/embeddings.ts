export interface Embeddings {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

/** all-MiniLM-L6-v2 output dimensionality. */
export const LOCAL_EMBEDDING_DIM = 384;
const LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

// Transformers.js is ESM-only; the extension compiles to CommonJS. Load it via a
// genuine dynamic import() (see claude_agent_client for the same bridge) so the
// CJS loader / jest do not choke on it at module-eval time.
type TransformersModule = typeof import('@xenova/transformers');
const import_transformers = new Function('m', 'return import(m)') as (
  m: string
) => Promise<TransformersModule>;

type FeatureExtractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

/**
 * Local, zero-token embeddings using all-MiniLM-L6-v2 via Transformers.js.
 * The model (~90MB ONNX) downloads on first use and is then cached on disk, so
 * subsequent runs are offline. Vectors are 384-dimensional and L2-normalized.
 */
export class LocalEmbeddings implements Embeddings {
  private extractor_promise?: Promise<FeatureExtractor>;

  private async get_extractor(): Promise<FeatureExtractor> {
    if (!this.extractor_promise) {
      this.extractor_promise = import_transformers('@xenova/transformers').then(
        (m) => m.pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL) as Promise<FeatureExtractor>
      );
    }
    return this.extractor_promise;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    return vector;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.get_extractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
}

/**
 * Deterministic, dependency-free embeddings for offline full-pipeline tests
 * (`BERGAMOT_LLM=fake`). Hashes tokens into a fixed-width normalized vector — no
 * semantic quality, just stable, fast, and offline so the pipeline can be
 * exercised without downloading a model or loading native ONNX bindings.
 */
export class FakeEmbeddings implements Embeddings {
  async embedQuery(text: string): Promise<number[]> {
    return embed_deterministic(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(embed_deterministic);
  }
}

function embed_deterministic(text: string): number[] {
  const vector = new Array<number>(LOCAL_EMBEDDING_DIM).fill(0);
  for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vector[hash % LOCAL_EMBEDDING_DIM] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}

/**
 * Constructs the embeddings provider. `BERGAMOT_LLM=fake` selects the offline
 * deterministic provider — the single switch shared with the fake LLM client so
 * full-pipeline tests run without any network or native dependency.
 */
export function create_embeddings(): Embeddings {
  if (process.env.BERGAMOT_LLM === 'fake') {
    return new FakeEmbeddings();
  }
  return new LocalEmbeddings();
}
