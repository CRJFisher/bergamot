import {
  Embeddings,
  FakeEmbeddings,
  LocalEmbeddings,
  create_embeddings,
  LOCAL_EMBEDDING_DIM,
} from './embeddings';

describe('FakeEmbeddings', () => {
  let embeddings: FakeEmbeddings;

  beforeEach(() => {
    embeddings = new FakeEmbeddings();
  });

  it('satisfies the Embeddings interface', () => {
    const e: Embeddings = embeddings;
    expect(typeof e.embedQuery).toBe('function');
    expect(typeof e.embedDocuments).toBe('function');
  });

  it('produces a vector of the local embedding dimensionality', async () => {
    const vector = await embeddings.embedQuery('hello world');
    expect(vector).toHaveLength(LOCAL_EMBEDDING_DIM);
    expect(typeof vector[0]).toBe('number');
  });

  it('is deterministic for the same input', async () => {
    const a = await embeddings.embedQuery('the quick brown fox');
    const b = await embeddings.embedQuery('the quick brown fox');
    expect(a).toEqual(b);
  });

  it('differs for different inputs', async () => {
    const a = await embeddings.embedQuery('cats');
    const b = await embeddings.embedQuery('databases');
    expect(a).not.toEqual(b);
  });

  it('returns unit-normalized vectors for non-empty text', async () => {
    const vector = await embeddings.embedQuery('alpha beta gamma');
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('embeds documents in order and returns one vector each', async () => {
    const result = await embeddings.embedDocuments(['one', 'two', 'three']);
    expect(result).toHaveLength(3);
    result.forEach((v) => expect(v).toHaveLength(LOCAL_EMBEDDING_DIM));
  });

  it('handles an empty document array', async () => {
    expect(await embeddings.embedDocuments([])).toEqual([]);
  });
});

describe('create_embeddings', () => {
  const original = process.env.BERGAMOT_LLM;
  afterEach(() => {
    if (original === undefined) delete process.env.BERGAMOT_LLM;
    else process.env.BERGAMOT_LLM = original;
  });

  it('returns the offline fake provider when BERGAMOT_LLM=fake', () => {
    process.env.BERGAMOT_LLM = 'fake';
    expect(create_embeddings()).toBeInstanceOf(FakeEmbeddings);
  });

  it('returns the local model provider otherwise', () => {
    delete process.env.BERGAMOT_LLM;
    expect(create_embeddings()).toBeInstanceOf(LocalEmbeddings);
  });
});
