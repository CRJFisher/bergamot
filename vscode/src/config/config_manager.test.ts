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
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('pkm-assistant');
      expect(mock_config.get).toHaveBeenCalledWith('openaiApiKey');
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('should return undefined and show error when API key not configured', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue(undefined)
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);
      
      const result = ConfigManager.get_openai_api_key();
      
      expect(result).toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'OpenAI API key is not configured. Please set it in settings.'
      );
    });

    it('should return undefined and show error when API key is empty string', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue('')
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);
      
      const result = ConfigManager.get_openai_api_key();
      
      expect(result).toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('get_memory_config()', () => {
    it('should return memory configuration with enabled true by default', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue(true)
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);
      
      const result = ConfigManager.get_memory_config();
      
      expect(result).toEqual({ enabled: true });
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('pkm-assistant.agentMemory');
      expect(mock_config.get).toHaveBeenCalledWith('enabled', true);
    });

    it('should return memory configuration with enabled false when disabled', () => {
      const mock_config = {
        get: jest.fn().mockReturnValue(false)
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mock_config);
      
      const result = ConfigManager.get_memory_config();
      
      expect(result).toEqual({ enabled: false });
    });
  });

  describe('get_markdown_db_path()', () => {
    it('should return the hardcoded markdown database path', () => {
      const path = ConfigManager.get_markdown_db_path();
      
      expect(path).toBe('/Users/chuck/workspace/pkm/webpages_db.md');
    });

    // TODO: Add test for configurable path when implemented
    it.todo('should return configurable path from settings when implemented');
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