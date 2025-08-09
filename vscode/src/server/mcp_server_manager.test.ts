import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';
import { MCPServerManager, MCPServerConfig } from './mcp_server_manager';
import { DuckDB } from '../duck_db';

// Mock vscode module
jest.mock('vscode', () => ({
  window: {
    showErrorMessage: jest.fn()
  }
}));

// Create a mock child process
class MockChildProcess extends EventEmitter {
  killed = false;
  
  kill(signal?: string): boolean {
    this.killed = true;
    // Simulate async exit
    setTimeout(() => this.emit('exit', 0), 10);
    return true;
  }
}

// Mock child_process module
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

describe('MCPServerManager', () => {
  let mcp_manager: MCPServerManager;
  let mock_config: MCPServerConfig;
  let mock_process: MockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mock_process = new MockChildProcess();
    (child_process.spawn as jest.Mock).mockReturnValue(mock_process);

    mock_config = {
      context: {
        extensionPath: '/test/extension',
        globalStorageUri: { fsPath: '/test/storage' }
      } as any,
      openai_api_key: 'test-api-key',
      duck_db: {} as DuckDB
    };

    mcp_manager = new MCPServerManager(mock_config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start()', () => {
    it('should spawn MCP server process with correct configuration', async () => {
      const start_promise = mcp_manager.start();
      
      // Fast-forward the startup delay
      jest.advanceTimersByTime(100);
      
      await start_promise;

      expect(child_process.spawn).toHaveBeenCalledWith(
        'node',
        ['/test/extension/dist/mcp_server_standalone.js'],
        {
          env: expect.objectContaining({
            OPENAI_API_KEY: 'test-api-key',
            STORAGE_PATH: '/test/storage',
            DUCK_DB_PATH: '/test/storage/webpage_categorizations.db'
          }),
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }
      );
    });

    it('should handle process error events', async () => {
      const start_promise = mcp_manager.start();
      
      const error = new Error('Process failed');
      mock_process.emit('error', error);

      await expect(start_promise).rejects.toThrow('Process failed');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'MCP server failed to start: Process failed'
      );
    });

    it('should log process exit events', async () => {
      const console_spy = jest.spyOn(console, 'log').mockImplementation();
      
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      mock_process.emit('exit', 1);

      expect(console_spy).toHaveBeenCalledWith(
        'MCP server process exited with code 1'
      );
      
      console_spy.mockRestore();
    });

    it('should clear process reference on exit', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      expect(mcp_manager.get_process()).toBeDefined();

      mock_process.emit('exit', 0);

      expect(mcp_manager.get_process()).toBeUndefined();
    });
  });

  describe('start_deferred()', () => {
    it('should start server after specified delay', () => {
      const start_spy = jest.spyOn(mcp_manager, 'start').mockResolvedValue();

      mcp_manager.start_deferred(3000);

      expect(start_spy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(3000);

      expect(start_spy).toHaveBeenCalled();
    });

    it('should use default delay of 2000ms', () => {
      const start_spy = jest.spyOn(mcp_manager, 'start').mockResolvedValue();

      mcp_manager.start_deferred();

      jest.advanceTimersByTime(1999);
      expect(start_spy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(start_spy).toHaveBeenCalled();
    });

    it('should handle start failure silently', async () => {
      const console_error_spy = jest.spyOn(console, 'error').mockImplementation();
      const console_log_spy = jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(mcp_manager, 'start').mockRejectedValue(new Error('Start failed'));

      mcp_manager.start_deferred(100);
      
      jest.advanceTimersByTime(100);
      
      // Allow promises to resolve
      await Promise.resolve();
      await Promise.resolve();

      expect(console_error_spy).toHaveBeenCalledWith(
        'Failed to start MCP server (deferred):',
        expect.any(Error)
      );
      expect(console_log_spy).toHaveBeenCalledWith(
        'MCP server will be unavailable for this session'
      );
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

      console_error_spy.mockRestore();
      console_log_spy.mockRestore();
    });
  });

  describe('stop()', () => {
    it('should terminate running process gracefully', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      const kill_spy = jest.spyOn(mock_process, 'kill');

      const stop_promise = mcp_manager.stop();
      
      // Simulate process exit
      jest.advanceTimersByTime(10);
      
      await stop_promise;

      expect(kill_spy).toHaveBeenCalledWith('SIGTERM');
      expect(mcp_manager.get_process()).toBeUndefined();
    });

    it('should force kill process after timeout', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      const kill_spy = jest.spyOn(mock_process, 'kill');
      
      // Override kill to not emit exit
      kill_spy.mockImplementation(function(this: MockChildProcess, signal?: string) {
        if (signal === 'SIGKILL') {
          this.killed = true;
          return true;
        }
        return true;
      });

      const stop_promise = mcp_manager.stop();

      // First SIGTERM
      expect(kill_spy).toHaveBeenCalledWith('SIGTERM');

      // Wait for force kill timeout
      jest.advanceTimersByTime(5000);
      
      await stop_promise;

      expect(kill_spy).toHaveBeenCalledWith('SIGKILL');
    });

    it('should handle stop when process not running', async () => {
      await expect(mcp_manager.stop()).resolves.not.toThrow();
    });
  });

  describe('is_running()', () => {
    it('should return false when process not started', () => {
      expect(mcp_manager.is_running()).toBe(false);
    });

    it('should return true when process is running', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      expect(mcp_manager.is_running()).toBe(true);
    });

    it('should return false after process killed', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      mock_process.killed = true;

      expect(mcp_manager.is_running()).toBe(false);
    });

    it('should return false after process exits', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      mock_process.emit('exit', 0);

      expect(mcp_manager.is_running()).toBe(false);
    });
  });

  describe('get_process()', () => {
    it('should return undefined before start', () => {
      expect(mcp_manager.get_process()).toBeUndefined();
    });

    it('should return process after start', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      const process = mcp_manager.get_process();
      expect(process).toBeDefined();
      expect(process).toBe(mock_process);
    });

    it('should return undefined after stop', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      const stop_promise = mcp_manager.stop();
      jest.advanceTimersByTime(10);
      await stop_promise;

      expect(mcp_manager.get_process()).toBeUndefined();
    });
  });
});