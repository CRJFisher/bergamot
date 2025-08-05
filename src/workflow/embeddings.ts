import OpenAI from 'openai';

export interface Embeddings {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddings implements Embeddings {
  private openai: OpenAI;
  private model: string;

  constructor(config: { apiKey: string; model?: string }) {
    this.openai = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'text-embedding-3-small';
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map(item => item.embedding);
  }
}