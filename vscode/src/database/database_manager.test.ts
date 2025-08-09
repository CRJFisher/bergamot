import * as vscode from 'vscode';
import { DatabaseManager } from './database_manager';
import { DuckDB } from '../duck_db';
import { MarkdownDatabase } from '../markdown_db';
import { LanceDBMemoryStore } from '../lance_db';
import { EpisodicMemoryStore } from '../memory/episodic_memory_store';
import { ProceduralMemoryStore } from '../memory/procedural_memory_store';
import { OpenAIEmbeddings } from '../workflow/embeddings';

// Mock dependencies
jest.mock('../duck_db');
jest.mock('../markdown_db');
jest.mock('../lance_db');
jest.mock('../memory/episodic_memory_store');
jest.mock('../memory/procedural_memory_store');
jest.mock('../workflow/embeddings');

describe('DatabaseManager', () => {
  let database_manager: DatabaseManager;
  let mock_duck_db: jest.Mocked<DuckDB>;
  let mock_context: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    database_manager = new DatabaseManager();
    
    // Setup mocks
    mock_duck_db = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    (DuckDB as jest.Mock).mockImplementation(() => mock_duck_db);
    (MarkdownDatabase as jest.Mock).mockImplementation(() => ({}));
    (LanceDBMemoryStore.create as jest.Mock) = jest.fn().mockResolvedValue({
      stop: jest.fn()
    });
    (OpenAIEmbeddings as jest.Mock).mockImplementation(() => ({}));
    
    mock_context = {
      globalStorageUri: { fsPath: '/test/storage' }
    } as any;
  });

  describe('initialize_core_databases()', () => {
    it('should initialize DuckDB and MarkdownDatabase', async () => {
      const storage_path = '/test/storage';
      const markdown_path = '/test/markdown.md';
      
      const result = await database_manager.initialize_core_databases(
        storage_path,
        markdown_path
      );
      
      expect(DuckDB).toHaveBeenCalledWith({
        database_path: '/test/storage/webpage_categorizations.db'
      });
      expect(MarkdownDatabase).toHaveBeenCalledWith(markdown_path);
      expect(mock_duck_db.init).toHaveBeenCalled();
      expect(result).toHaveProperty('duck_db');
      expect(result).toHaveProperty('markdown_db');
    });

    it('should handle DuckDB initialization failure', async () => {
      mock_duck_db.init.mockRejectedValue(new Error('DB init failed'));
      
      await expect(
        database_manager.initialize_core_databases('/test', '/test/md')
      ).rejects.toThrow('DB init failed');
    });
  });

  describe('initialize_memory_store()', () => {
    it('should create LanceDB memory store with embeddings', async () => {
      const storage_path = '/test/storage';
      const api_key = 'test-api-key';
      
      await database_manager.initialize_memory_store(storage_path, api_key);
      
      expect(LanceDBMemoryStore.create).toHaveBeenCalledWith(
        storage_path,
        expect.objectContaining({
          embeddings: expect.any(Object)
        })
      );
      expect(OpenAIEmbeddings).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        apiKey: api_key
      });
    });
  });

  describe('initialize_memory_features()', () => {
    let mock_memory_db: any;

    beforeEach(() => {
      mock_memory_db = {};
      (EpisodicMemoryStore as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined)
      }));
      (ProceduralMemoryStore as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined)
      }));
    });

    it('should initialize both memory stores when enabled', async () => {
      const result = await database_manager.initialize_memory_features(
        mock_duck_db,
        mock_memory_db,
        true
      );
      
      expect(EpisodicMemoryStore).toHaveBeenCalledWith(mock_duck_db, mock_memory_db);
      expect(ProceduralMemoryStore).toHaveBeenCalledWith(mock_duck_db);
      expect(result.episodic_store).toBeDefined();
      expect(result.procedural_store).toBeDefined();
    });

    it('should return empty object when memory features disabled', async () => {
      const result = await database_manager.initialize_memory_features(
        mock_duck_db,
        mock_memory_db,
        false
      );
      
      expect(EpisodicMemoryStore).not.toHaveBeenCalled();
      expect(ProceduralMemoryStore).not.toHaveBeenCalled();
      expect(result.episodic_store).toBeUndefined();
      expect(result.procedural_store).toBeUndefined();
    });
  });

  describe('initialize_all()', () => {
    it('should initialize all databases with memory features enabled', async () => {
      (EpisodicMemoryStore as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined)
      }));
      (ProceduralMemoryStore as jest.Mock).mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined)
      }));
      
      const result = await database_manager.initialize_all(
        mock_context,
        'test-api-key',
        '/test/markdown.md',
        true
      );
      
      expect(result.duck_db).toBeDefined();
      expect(result.markdown_db).toBeDefined();
      expect(result.memory_db).toBeDefined();
      expect(result.episodic_store).toBeDefined();
      expect(result.procedural_store).toBeDefined();
    });

    it('should initialize databases without memory features when disabled', async () => {
      const result = await database_manager.initialize_all(
        mock_context,
        'test-api-key',
        '/test/markdown.md',
        false
      );
      
      expect(result.duck_db).toBeDefined();
      expect(result.markdown_db).toBeDefined();
      expect(result.memory_db).toBeDefined();
      expect(result.episodic_store).toBeUndefined();
      expect(result.procedural_store).toBeUndefined();
    });
  });

  describe('close_all()', () => {
    it('should close all database connections', async () => {
      const mock_memory_db = { stop: jest.fn() };
      
      await database_manager.initialize_all(
        mock_context,
        'test-api-key',
        '/test/markdown.md',
        false
      );
      
      // Override the memory_db with our mock
      const databases = database_manager.get_databases();
      if (databases) {
        databases.memory_db = mock_memory_db as any;
      }
      
      await database_manager.close_all();
      
      expect(mock_duck_db.close).toHaveBeenCalled();
      expect(mock_memory_db.stop).toHaveBeenCalled();
    });

    it('should handle closing when databases not initialized', async () => {
      await expect(database_manager.close_all()).resolves.not.toThrow();
    });
  });

  describe('get_databases()', () => {
    it('should return undefined before initialization', () => {
      expect(database_manager.get_databases()).toBeUndefined();
    });

    it('should return databases after initialization', async () => {
      await database_manager.initialize_all(
        mock_context,
        'test-api-key',
        '/test/markdown.md',
        false
      );
      
      const databases = database_manager.get_databases();
      expect(databases).toBeDefined();
      expect(databases?.duck_db).toBeDefined();
      expect(databases?.markdown_db).toBeDefined();
    });
  });
});