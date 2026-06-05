import * as vscode from 'vscode';
import { CommandManager, CommandConfig } from './command_manager';
import { DuckDB } from '../duck_db';
import { ServerManager } from '../server/server_manager';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { get_gate_metrics } from '../workflow/gate_metrics';

// Mock dependencies
jest.mock('../webpage_hover_provider');
jest.mock('../workflow/gate_metrics');

// Mock vscode module
jest.mock('vscode', () => ({
  commands: {
    registerCommand: jest.fn()
  },
  window: {
    createOutputChannel: jest.fn()
  }
}));

describe('CommandManager', () => {
  let command_manager: CommandManager;
  let mock_config: CommandConfig;
  let mock_context: vscode.ExtensionContext;
  let mock_subscriptions: vscode.Disposable[];

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock context
    mock_subscriptions = [];
    jest.spyOn(mock_subscriptions, 'push');
    mock_context = {
      subscriptions: mock_subscriptions
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext;

    // Setup mock config
    mock_config = {
      context: mock_context,
      duck_db: {} as DuckDB,
      server_manager: {
        get_queue_processor: jest.fn().mockReturnValue(undefined)
      } as Partial<ServerManager> as ServerManager,
      storage_base: '/test/storage'
    };

    // Setup mock for capture gate metrics
    (get_gate_metrics as jest.Mock) = jest.fn().mockReturnValue({
      total_pages: 100,
      captured_pages: 80,
      dropped_pages: 20,
      drop_reasons: {
        'link_heavy': 10,
        'content_too_small': 5,
        'pdf': 5
      }
    });

    command_manager = new CommandManager(mock_config);
  });

  describe('register_all()', () => {
    it('should register the hover provider (no LanceDB search command)', () => {
      command_manager.register_all();

      expect(register_webpage_hover_provider).toHaveBeenCalledWith(
        mock_context,
        mock_config.duck_db
      );
    });

    it('should register filter metrics command', () => {
      const mock_command = { dispose: jest.fn() };
      (vscode.commands.registerCommand as jest.Mock).mockReturnValue(mock_command);

      command_manager.register_all();

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'bergamot.showCaptureMetrics',
        expect.any(Function)
      );
      expect(mock_context.subscriptions.push).toHaveBeenCalledWith(mock_command);
    });
  });

  describe('show_gate_metrics()', () => {
    let mock_output_channel: {
      clear: jest.Mock;
      appendLine: jest.Mock;
      show: jest.Mock;
    };

    beforeEach(() => {
      mock_output_channel = {
        clear: jest.fn(),
        appendLine: jest.fn(),
        show: jest.fn()
      };
      (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mock_output_channel);
    });

    it('should display capture gate metrics in output channel', () => {
      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showCaptureMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      command_manager.register_all();
      mock_command_handler();

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
        'Bergamot Capture Gate Metrics'
      );
      expect(mock_output_channel.clear).toHaveBeenCalled();
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        '=== Capture Gate Metrics ==='
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Total pages seen: 100'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Captured: 80 (80.0%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Dropped: 20 (20.0%)'
      );
      expect(mock_output_channel.show).toHaveBeenCalled();
    });

    it('should display drop reasons sorted by count', () => {
      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showCaptureMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      command_manager.register_all();
      mock_command_handler();

      const calls: string[] = mock_output_channel.appendLine.mock.calls
        .map((call) => call[0] as string)
        .filter((line) => /link_heavy|content_too_small|pdf/.test(line));

      expect(calls[0]).toContain('link_heavy: 10');
      expect(calls[1]).toContain('content_too_small: 5');
      expect(calls[2]).toContain('pdf: 5');
    });

    it('should handle zero total pages gracefully', () => {
      (get_gate_metrics as jest.Mock).mockReturnValue({
        total_pages: 0,
        captured_pages: 0,
        dropped_pages: 0,
        drop_reasons: {}
      });

      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showCaptureMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      command_manager.register_all();
      mock_command_handler();

      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Captured: 0 (0%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Dropped: 0 (0%)'
      );
    });
  });

  describe('dispose()', () => {
    it('should dispose all registered commands', () => {
      const mock_disposable = { dispose: jest.fn() };

      (vscode.commands.registerCommand as jest.Mock).mockReturnValue(mock_disposable);

      command_manager.register_all();
      command_manager.dispose();

      // The CommandManager only adds the filter metrics command to its disposables
      expect(mock_disposable.dispose).toHaveBeenCalled();
    });

    it('should clear disposables array after dispose', () => {
      const mock_disposable = { dispose: jest.fn() };
      (vscode.commands.registerCommand as jest.Mock).mockReturnValue(mock_disposable);

      command_manager.register_all();
      command_manager.dispose();

      // Calling dispose again should not throw
      expect(() => command_manager.dispose()).not.toThrow();
    });
  });

  describe('percentage calculation', () => {
    it('should calculate percentages correctly', () => {
      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showCaptureMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      const mock_output_channel = {
        clear: jest.fn(),
        appendLine: jest.fn(),
        show: jest.fn()
      };
      (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mock_output_channel);

      (get_gate_metrics as jest.Mock).mockReturnValue({
        total_pages: 333,
        captured_pages: 111,
        dropped_pages: 222,
        drop_reasons: {}
      });

      command_manager.register_all();
      mock_command_handler();

      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Captured: 111 (33.3%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Dropped: 222 (66.7%)'
      );
    });
  });
});