import { OpenAIEmbeddings, Embeddings } from './embeddings';
import OpenAI from 'openai';

// Mock OpenAI
jest.mock('openai');

const mockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const mockEmbeddingsCreate = jest.fn();

// Setup mock OpenAI instance
const mockOpenAIInstance = {
  embeddings: {
    create: mockEmbeddingsCreate,
  },
};

mockOpenAI.mockImplementation(() => mockOpenAIInstance as any);

describe('OpenAIEmbeddings', () => {
  let embeddings: OpenAIEmbeddings;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with API key and default model', () => {
      embeddings = new OpenAIEmbeddings({ apiKey: 'test-api-key' });

      expect(mockOpenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
      expect(embeddings).toBeInstanceOf(OpenAIEmbeddings);
    });

    it('should initialize with API key and custom model', () => {
      embeddings = new OpenAIEmbeddings({ 
        apiKey: 'test-api-key', 
        model: 'text-embedding-3-large' 
      });

      expect(mockOpenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
      expect(embeddings).toBeInstanceOf(OpenAIEmbeddings);
    });

    it('should implement Embeddings interface', () => {
      embeddings = new OpenAIEmbeddings({ apiKey: 'test-api-key' });
      
      expect(embeddings).toHaveProperty('embedQuery');
      expect(embeddings).toHaveProperty('embedDocuments');
      expect(typeof embeddings.embedQuery).toBe('function');
      expect(typeof embeddings.embedDocuments).toBe('function');
    });
  });

  describe('embedQuery', () => {
    beforeEach(() => {
      embeddings = new OpenAIEmbeddings({ apiKey: 'test-api-key' });
    });

    it('should embed a single text query with default model', async () => {
      const mockResponse = {
        data: [
          {
            embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
          },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedQuery('test query');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test query',
      });

      expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    });

    it('should embed a single text query with custom model', async () => {
      embeddings = new OpenAIEmbeddings({ 
        apiKey: 'test-api-key', 
        model: 'text-embedding-3-large' 
      });

      const mockResponse = {
        data: [
          {
            embedding: [0.6, 0.7, 0.8, 0.9, 1.0],
          },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedQuery('custom model query');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: 'custom model query',
      });

      expect(result).toEqual([0.6, 0.7, 0.8, 0.9, 1.0]);
    });

    it('should handle empty text query', async () => {
      const mockResponse = {
        data: [
          {
            embedding: [0.0, 0.0, 0.0],
          },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedQuery('');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: '',
      });

      expect(result).toEqual([0.0, 0.0, 0.0]);
    });

    it('should handle long text query', async () => {
      const longText = 'a'.repeat(1000);
      const mockResponse = {
        data: [
          {
            embedding: [0.1, 0.2, 0.3],
          },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedQuery(longText);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: longText,
      });

      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('should handle API errors', async () => {
      const apiError = new Error('API rate limit exceeded');
      mockEmbeddingsCreate.mockRejectedValue(apiError);

      await expect(embeddings.embedQuery('test query')).rejects.toThrow(
        'API rate limit exceeded'
      );
    });

    it('should handle malformed API response', async () => {
      const malformedResponse = {
        data: [], // Empty data array
      };

      mockEmbeddingsCreate.mockResolvedValue(malformedResponse);

      await expect(embeddings.embedQuery('test query')).rejects.toThrow();
    });

    it('should handle special characters and unicode', async () => {
      const specialText = '你好世界 🌍 émojis & spëcial chars!';
      const mockResponse = {
        data: [
          {
            embedding: [0.5, 0.6, 0.7],
          },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedQuery(specialText);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: specialText,
      });

      expect(result).toEqual([0.5, 0.6, 0.7]);
    });
  });

  describe('embedDocuments', () => {
    beforeEach(() => {
      embeddings = new OpenAIEmbeddings({ apiKey: 'test-api-key' });
    });

    it('should embed multiple documents with default model', async () => {
      const mockResponse = {
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
          { embedding: [0.7, 0.8, 0.9] },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const texts = ['first document', 'second document', 'third document'];
      const result = await embeddings.embedDocuments(texts);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: texts,
      });

      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ]);
    });

    it('should embed multiple documents with custom model', async () => {
      embeddings = new OpenAIEmbeddings({ 
        apiKey: 'test-api-key', 
        model: 'text-embedding-ada-002' 
      });

      const mockResponse = {
        data: [
          { embedding: [1.1, 1.2] },
          { embedding: [2.1, 2.2] },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const texts = ['doc one', 'doc two'];
      const result = await embeddings.embedDocuments(texts);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: texts,
      });

      expect(result).toEqual([
        [1.1, 1.2],
        [2.1, 2.2],
      ]);
    });

    it('should handle empty document array', async () => {
      const mockResponse = {
        data: [],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedDocuments([]);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: [],
      });

      expect(result).toEqual([]);
    });

    it('should handle single document array', async () => {
      const mockResponse = {
        data: [
          { embedding: [0.1, 0.2, 0.3, 0.4] },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const texts = ['single document'];
      const result = await embeddings.embedDocuments(texts);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: texts,
      });

      expect(result).toEqual([
        [0.1, 0.2, 0.3, 0.4],
      ]);
    });

    it('should handle documents with varying lengths', async () => {
      const mockResponse = {
        data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
          { embedding: [0.5, 0.6] },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const texts = [
        'short',
        'this is a medium length document with more words',
        'a'.repeat(500), // Long document
      ];
      const result = await embeddings.embedDocuments(texts);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: texts,
      });

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ]);
    });

    it('should handle documents with empty strings', async () => {
      const mockResponse = {
        data: [
          { embedding: [0.0, 0.0] },
          { embedding: [0.1, 0.2] },
          { embedding: [0.0, 0.0] },
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const texts = ['', 'non-empty content', ''];
      const result = await embeddings.embedDocuments(texts);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: texts,
      });

      expect(result).toEqual([
        [0.0, 0.0],
        [0.1, 0.2],
        [0.0, 0.0],
      ]);
    });

    it('should handle API errors during document embedding', async () => {
      const apiError = new Error('Invalid API key');
      mockEmbeddingsCreate.mockRejectedValue(apiError);

      const texts = ['doc1', 'doc2'];
      await expect(embeddings.embedDocuments(texts)).rejects.toThrow(
        'Invalid API key'
      );
    });

    it('should handle mismatched response data length', async () => {
      const mockResponse = {
        data: [
          { embedding: [0.1, 0.2] },
          // Missing second embedding for second document
        ],
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const texts = ['doc1', 'doc2'];
      const result = await embeddings.embedDocuments(texts);

      // Should still return what it got, let the caller handle the mismatch
      expect(result).toEqual([
        [0.1, 0.2],
      ]);
    });

    it('should handle large batch of documents', async () => {
      const batchSize = 100;
      const documents = Array.from({ length: batchSize }, (_, i) => `Document ${i}`);
      const mockEmbeddings = Array.from({ length: batchSize }, (_, i) => ({
        embedding: [i * 0.1, i * 0.2],
      }));

      const mockResponse = {
        data: mockEmbeddings,
      };

      mockEmbeddingsCreate.mockResolvedValue(mockResponse);

      const result = await embeddings.embedDocuments(documents);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: documents,
      });

      expect(result).toHaveLength(batchSize);
      expect(result[0]).toEqual([0, 0]);
      expect(result[99]).toEqual([9.9, 19.8]);
    });
  });

  describe('error handling and edge cases', () => {
    beforeEach(() => {
      embeddings = new OpenAIEmbeddings({ apiKey: 'test-api-key' });
    });

    it('should handle network timeout errors', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      mockEmbeddingsCreate.mockRejectedValue(timeoutError);

      await expect(embeddings.embedQuery('test')).rejects.toThrow('Request timeout');
      await expect(embeddings.embedDocuments(['test'])).rejects.toThrow('Request timeout');
    });

    it('should handle rate limiting errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.name = 'RateLimitError';
      mockEmbeddingsCreate.mockRejectedValue(rateLimitError);

      await expect(embeddings.embedQuery('test')).rejects.toThrow('Rate limit exceeded');
      await expect(embeddings.embedDocuments(['test'])).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle invalid model errors', async () => {
      const invalidModelError = new Error('Model not found');
      mockEmbeddingsCreate.mockRejectedValue(invalidModelError);

      await expect(embeddings.embedQuery('test')).rejects.toThrow('Model not found');
      await expect(embeddings.embedDocuments(['test'])).rejects.toThrow('Model not found');
    });
  });

  describe('type compliance', () => {
    it('should satisfy Embeddings interface contract', () => {
      const embeddings: Embeddings = new OpenAIEmbeddings({ apiKey: 'test' });
      
      // These should compile without TypeScript errors
      expect(typeof embeddings.embedQuery).toBe('function');
      expect(typeof embeddings.embedDocuments).toBe('function');
    });

    it('should return correct types from methods', async () => {
      embeddings = new OpenAIEmbeddings({ apiKey: 'test-api-key' });

      const mockSingleResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      };

      const mockMultiResponse = {
        data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
        ],
      };

      mockEmbeddingsCreate
        .mockResolvedValueOnce(mockSingleResponse)
        .mockResolvedValueOnce(mockMultiResponse);

      const singleResult = await embeddings.embedQuery('test');
      const multiResult = await embeddings.embedDocuments(['doc1', 'doc2']);

      // Type assertions
      expect(Array.isArray(singleResult)).toBe(true);
      expect(typeof singleResult[0]).toBe('number');
      
      expect(Array.isArray(multiResult)).toBe(true);
      expect(Array.isArray(multiResult[0])).toBe(true);
      expect(typeof multiResult[0][0]).toBe('number');
    });
  });
});