import * as vscode from 'vscode';
import { ConfigManager } from './config_manager';

// Mock vscode module
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn()
  },
  window: {
    showErrorMessage: jest.fn()
  }
}));

describe('ConfigManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get_dev_mode()', () => {
    it('should default to false', () => {
      const mock_config = {
        get: jest.fn((_key: string, default_value: unknown) => default_value)
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);

      expect(ConfigManager.get_dev_mode()).toBe(false);
      expect(mock_config.get).toHaveBeenCalledWith('devMode', false);
    });
  });

  describe('get_duck_db_path()', () => {
    it('should construct correct DuckDB path from storage path', () => {
      const storage_path = '/test/storage/path';
      
      const result = ConfigManager.get_duck_db_path(storage_path);
      
      expect(result).toBe('/test/storage/path/webpage_categorizations.db');
    });

    it('should handle storage paths with trailing slash', () => {
      const storage_path = '/test/storage/path/';
      
      const result = ConfigManager.get_duck_db_path(storage_path);
      
      expect(result).toBe('/test/storage/path//webpage_categorizations.db');
    });
  });
});