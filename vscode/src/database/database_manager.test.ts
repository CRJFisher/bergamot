import * as vscode from 'vscode';
import { DatabaseManager } from './database_manager';
import { DuckDB } from '../duck_db';

jest.mock('../duck_db');

describe('DatabaseManager', () => {
  let database_manager: DatabaseManager;
  let mock_duck_db: jest.Mocked<DuckDB>;
  let mock_context: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    database_manager = new DatabaseManager();

    mock_duck_db = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    } as Partial<jest.Mocked<DuckDB>> as jest.Mocked<DuckDB>;

    (DuckDB as jest.Mock).mockImplementation(() => mock_duck_db);

    mock_context = {
      globalStorageUri: { fsPath: '/test/storage' }
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;
  });

  describe('initialize_all()', () => {
    it('should initialize the DuckDB store (no LanceDB at ingest)', async () => {
      const result = await database_manager.initialize_all(
        mock_context.globalStorageUri.fsPath
      );

      expect(DuckDB).toHaveBeenCalledWith({
        database_path: '/test/storage/webpage_categorizations.db'
      });
      expect(mock_duck_db.init).toHaveBeenCalled();
      expect(result.duck_db).toBeDefined();
      expect(Object.keys(result)).toEqual(['duck_db']);
    });

    it('should propagate DuckDB initialization failure', async () => {
      mock_duck_db.init.mockRejectedValue(new Error('DB init failed'));

      await expect(
        database_manager.initialize_all(mock_context.globalStorageUri.fsPath)
      ).rejects.toThrow('DB init failed');
    });
  });

  describe('close_all()', () => {
    it('should close the DuckDB connection', async () => {
      await database_manager.initialize_all(mock_context.globalStorageUri.fsPath);
      await database_manager.close_all();
      expect(mock_duck_db.close).toHaveBeenCalled();
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
    });
  });
});
