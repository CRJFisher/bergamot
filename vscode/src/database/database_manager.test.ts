import * as vscode from 'vscode';
import { DatabaseManager } from './database_manager';
import { DuckDB } from '../duck_db';
import { LanceDBMemoryStore } from '../lance_db';
import { create_embeddings } from '../workflow/embeddings';

// Mock dependencies
jest.mock('../duck_db');
jest.mock('../lance_db');
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
    } as Partial<jest.Mocked<DuckDB>> as jest.Mocked<DuckDB>;

    (DuckDB as jest.Mock).mockImplementation(() => mock_duck_db);
    (LanceDBMemoryStore.create as jest.Mock) = jest.fn().mockResolvedValue({
      stop: jest.fn(),
      drop_table_if_vector_dim_mismatch: jest.fn().mockResolvedValue(undefined)
    });
    (create_embeddings as jest.Mock).mockReturnValue({});

    mock_context = {
      globalStorageUri: { fsPath: '/test/storage' }
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
  });

  describe('initialize_memory_store()', () => {
    it('should create LanceDB memory store with local embeddings', async () => {
      const storage_path = '/test/storage';

      await database_manager.initialize_memory_store(storage_path);

      // The store must be created in the `webpage_memory.db` subdirectory so the
      // MCP reader (which resolves the same subdir) sees what the writer stored.
      expect(LanceDBMemoryStore.create).toHaveBeenCalledWith(
        `${storage_path}/webpage_memory.db`,
        expect.objectContaining({
          embeddings: expect.any(Object)
        })
      );
      // Embeddings are local (zero-token); no OpenAI key is involved.
      expect(create_embeddings).toHaveBeenCalled();
    });
  });

  describe('initialize_all()', () => {
    it('should initialize DuckDB and the memory store', async () => {
      const result = await database_manager.initialize_all(
        mock_context.globalStorageUri.fsPath
      );

      expect(DuckDB).toHaveBeenCalledWith({
        database_path: '/test/storage/webpage_categorizations.db'
      });
      expect(mock_duck_db.init).toHaveBeenCalled();
      expect(LanceDBMemoryStore.create).toHaveBeenCalledWith(
        '/test/storage/webpage_memory.db',
        expect.objectContaining({
          embeddings: expect.any(Object)
        })
      );
      expect(result.duck_db).toBeDefined();
      expect(result.memory_db).toBeDefined();
      expect(Object.keys(result).sort()).toEqual(['duck_db', 'memory_db']);
    });

    it('should propagate DuckDB initialization failure', async () => {
      mock_duck_db.init.mockRejectedValue(new Error('DB init failed'));

      await expect(
        database_manager.initialize_all(mock_context.globalStorageUri.fsPath)
      ).rejects.toThrow('DB init failed');
    });
  });

  describe('close_all()', () => {
    it('should close all database connections', async () => {
      const mock_memory_db = { stop: jest.fn() } as Partial<LanceDBMemoryStore> as LanceDBMemoryStore;

      await database_manager.initialize_all(mock_context.globalStorageUri.fsPath);

      // Override the memory_db with our mock
      const databases = database_manager.get_databases();
      if (databases) {
        databases.memory_db = mock_memory_db;
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
      await database_manager.initialize_all(mock_context.globalStorageUri.fsPath);

      const databases = database_manager.get_databases();
      expect(databases).toBeDefined();
      expect(databases?.duck_db).toBeDefined();
      expect(databases?.memory_db).toBeDefined();
    });
  });
});
