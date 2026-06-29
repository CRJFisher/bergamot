import { DatabaseManager } from './database_manager';
import { DuckDB, create_metadata_schema } from '../duck_db';

jest.mock('../duck_db');

const STORAGE_PATH = '/test/storage';
const ENCRYPTION_KEY = 'test-encryption-key';

describe('DatabaseManager', () => {
  let database_manager: DatabaseManager;
  let mock_duck_db: jest.Mocked<DuckDB>;

  beforeEach(() => {
    jest.clearAllMocks();
    database_manager = new DatabaseManager();

    mock_duck_db = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as Partial<jest.Mocked<DuckDB>> as jest.Mocked<DuckDB>;

    (DuckDB as jest.Mock).mockImplementation(() => mock_duck_db);
    (create_metadata_schema as jest.Mock).mockResolvedValue(undefined);
  });

  describe('initialize_all()', () => {
    it('opens the encrypted DuckDB store at the metadata db path', async () => {
      const result = await database_manager.initialize_all(
        STORAGE_PATH,
        ENCRYPTION_KEY
      );

      expect(DuckDB).toHaveBeenCalledWith({
        database_path: '/test/storage/webpage_categorizations.db',
        encryption_key: ENCRYPTION_KEY,
      });
      expect(mock_duck_db.init).toHaveBeenCalledTimes(1);
      expect(result.duck_db).toBe(mock_duck_db);
      expect(Object.keys(result)).toEqual(['duck_db']);
    });

    it('applies the metadata schema after opening the store', async () => {
      await database_manager.initialize_all(STORAGE_PATH, ENCRYPTION_KEY);

      expect(create_metadata_schema).toHaveBeenCalledWith(mock_duck_db);
    });

    it('propagates an open failure from DuckDB', async () => {
      mock_duck_db.init.mockRejectedValue(new Error('DB init failed'));

      await expect(
        database_manager.initialize_all(STORAGE_PATH, ENCRYPTION_KEY)
      ).rejects.toThrow('DB init failed');
      expect(create_metadata_schema).not.toHaveBeenCalled();
    });

    it('propagates a schema-creation failure', async () => {
      (create_metadata_schema as jest.Mock).mockRejectedValue(
        new Error('schema failed')
      );

      await expect(
        database_manager.initialize_all(STORAGE_PATH, ENCRYPTION_KEY)
      ).rejects.toThrow('schema failed');
    });
  });

  describe('close_all()', () => {
    it('closes the DuckDB connection when initialized', async () => {
      await database_manager.initialize_all(STORAGE_PATH, ENCRYPTION_KEY);
      await database_manager.close_all();

      expect(mock_duck_db.close).toHaveBeenCalledTimes(1);
    });

    it('resolves without error when no store was opened', async () => {
      await expect(database_manager.close_all()).resolves.toBeUndefined();
      expect(mock_duck_db.close).not.toHaveBeenCalled();
    });
  });
});
