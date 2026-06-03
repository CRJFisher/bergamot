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

  describe('get_openai_api_key()', () => {
    it('should return API key when configured', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue('test-api-key-123')
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);
      
      const result = ConfigManager.get_openai_api_key();
      
      expect(result).toBe('test-api-key-123');
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('bergamot');
      expect(mock_config.get).toHaveBeenCalledWith('openaiApiKey');
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('should return undefined when API key not configured (key is optional)', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue(undefined)
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);

      const result = ConfigManager.get_openai_api_key();

      // The key is optional now (default provider is Claude, embeddings local),
      // so a missing key is not an error.
      expect(result).toBeUndefined();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('should return undefined when API key is empty string', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue('')
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);

      const result = ConfigManager.get_openai_api_key();

      expect(result).toBeUndefined();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('get_llm_provider()', () => {
    it('should default to claude', () => {
      const mock_config = {
        get: jest.fn((_key: string, default_value: unknown) => default_value)
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);

      expect(ConfigManager.get_llm_provider()).toBe('claude');
      expect(mock_config.get).toHaveBeenCalledWith('llmProvider', 'claude');
    });
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