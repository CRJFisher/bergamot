import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { MCPServerManager, MCPServerConfig } from './mcp_server_manager';

jest.mock('vscode', () => ({
  window: {
    showErrorMessage: jest.fn()
  }
}));

class MockChildProcess extends EventEmitter {
  killed = false;

  kill(): boolean {
    this.killed = true;
    setTimeout(() => this.emit('exit', 0), 10);
    return true;
  }
}

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
      } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext
    };

    mcp_manager = new MCPServerManager(mock_config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start()', () => {
    it('spawns the standalone script via the host binary in node mode', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      expect(child_process.spawn).toHaveBeenCalledWith(
        process.execPath,
        ['/test/extension/out/mcp_server_standalone.js'],
        {
          env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
          stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        }
      );
    });

    it('rejects and surfaces an error message on process error', async () => {
      const start_promise = mcp_manager.start();

      const error = new Error('Process failed');
      mock_process.emit('error', error);

      await expect(start_promise).rejects.toThrow('Process failed');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'MCP server failed to start: Process failed'
      );
    });

    it('resolves after the settle delay when no error occurs', async () => {
      const start_promise = mcp_manager.start();

      let resolved = false;
      start_promise.then(() => { resolved = true; });

      jest.advanceTimersByTime(99);
      await Promise.resolve();
      expect(resolved).toBe(false);

      jest.advanceTimersByTime(1);
      await start_promise;
      expect(resolved).toBe(true);
    });

    it('logs the exit code when the process exits', async () => {
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
  });

  describe('start_deferred()', () => {
    it('starts the server only after the specified delay elapses', () => {
      const start_spy = jest.spyOn(mcp_manager, 'start').mockResolvedValue();

      mcp_manager.start_deferred(3000);

      jest.advanceTimersByTime(2999);
      expect(start_spy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(start_spy).toHaveBeenCalledTimes(1);
    });

    it('defaults to a 2000ms delay', () => {
      const start_spy = jest.spyOn(mcp_manager, 'start').mockResolvedValue();

      mcp_manager.start_deferred();

      jest.advanceTimersByTime(1999);
      expect(start_spy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(start_spy).toHaveBeenCalledTimes(1);
    });

    it('swallows start failures without surfacing a user-facing error', async () => {
      const console_error_spy = jest.spyOn(console, 'error').mockImplementation();
      const console_log_spy = jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(mcp_manager, 'start').mockRejectedValue(new Error('Start failed'));

      mcp_manager.start_deferred(100);

      jest.advanceTimersByTime(100);

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
    it('terminates a running process gracefully with SIGTERM', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      const kill_spy = jest.spyOn(mock_process, 'kill');

      const stop_promise = mcp_manager.stop();
      jest.advanceTimersByTime(10);
      await stop_promise;

      expect(kill_spy).toHaveBeenCalledWith('SIGTERM');
      expect(kill_spy).not.toHaveBeenCalledWith('SIGKILL');
    });

    it('escalates to SIGKILL when graceful shutdown is ignored', async () => {
      const start_promise = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await start_promise;

      const kill_spy = jest.spyOn(mock_process, 'kill');
      kill_spy.mockImplementation(function(this: MockChildProcess, signal?: string) {
        if (signal === 'SIGKILL') {
          this.killed = true;
        }
        return true;
      });

      const stop_promise = mcp_manager.stop();

      expect(kill_spy).toHaveBeenCalledWith('SIGTERM');

      jest.advanceTimersByTime(5000);
      await stop_promise;

      expect(kill_spy).toHaveBeenCalledWith('SIGKILL');
    });

    it('resolves without killing anything when no process is running', async () => {
      const kill_spy = jest.spyOn(mock_process, 'kill');

      await expect(mcp_manager.stop()).resolves.toBeUndefined();
      expect(kill_spy).not.toHaveBeenCalled();
    });

    it('can be restarted after stopping', async () => {
      const first_start = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await first_start;

      const stop_promise = mcp_manager.stop();
      jest.advanceTimersByTime(10);
      await stop_promise;

      const second_process = new MockChildProcess();
      (child_process.spawn as jest.Mock).mockReturnValue(second_process);

      const second_start = mcp_manager.start();
      jest.advanceTimersByTime(100);
      await second_start;

      expect(child_process.spawn).toHaveBeenCalledTimes(2);
    });
  });
});
