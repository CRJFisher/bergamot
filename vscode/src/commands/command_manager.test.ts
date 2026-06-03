import * as vscode from 'vscode';
import { CommandManager, CommandConfig } from './command_manager';
import { DuckDB } from '../duck_db';
import { LanceDBMemoryStore } from '../lance_db';
import { ServerManager } from '../server/server_manager';
import { register_webpage_search_commands } from '../webpage_search_commands';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { global_filter_metrics } from '../workflow/filter_metrics';

// Mock dependencies
jest.mock('../webpage_search_commands');
jest.mock('../webpage_hover_provider');
jest.mock('../workflow/filter_metrics');

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
      memory_db: {} as LanceDBMemoryStore,
      server_manager: {
        get_queue_processor: jest.fn().mockReturnValue(undefined)
      } as Partial<ServerManager> as ServerManager,
      storage_base: '/test/storage'
    };

    // Setup mock for filter metrics
    (global_filter_metrics.get_metrics as jest.Mock) = jest.fn().mockReturnValue({
      total_pages: 100,
      processed_pages: 80,
      filtered_pages: 20,
      average_confidence: 0.85,
      page_types: {
        'article': 40,
        'documentation': 30,
        'other': 30
      },
      filter_reasons: {
        'not_relevant': 10,
        'low_confidence': 5,
        'duplicate': 5
      }
    });

    command_manager = new CommandManager(mock_config);
  });

  describe('register_all()', () => {
    it('should register core commands', () => {
      command_manager.register_all();

      expect(register_webpage_search_commands).toHaveBeenCalledWith(
        mock_context,
        mock_config.memory_db
      );
      expect(register_webpage_hover_provider).toHaveBeenCalledWith(
        mock_context,
        mock_config.duck_db,
        mock_config.memory_db
      );
    });

    it('should register filter metrics command', () => {
      const mock_command = { dispose: jest.fn() };
      (vscode.commands.registerCommand as jest.Mock).mockReturnValue(mock_command);

      command_manager.register_all();

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'bergamot.showFilterMetrics',
        expect.any(Function)
      );
      expect(mock_context.subscriptions.push).toHaveBeenCalledWith(mock_command);
    });
  });

  describe('show_filter_metrics()', () => {
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

    it('should display filter metrics in output channel', () => {
      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showFilterMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      command_manager.register_all();
      mock_command_handler();

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
        'PKM Assistant Filter Metrics'
      );
      expect(mock_output_channel.clear).toHaveBeenCalled();
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        '=== Webpage Filter Metrics ==='
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Total pages analyzed: 100'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Pages processed: 80 (80.0%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Pages filtered: 20 (20.0%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Average confidence: 0.85'
      );
      expect(mock_output_channel.show).toHaveBeenCalled();
    });

    it('should display page types sorted by count', () => {
      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showFilterMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      command_manager.register_all();
      mock_command_handler();

      // Check that page types are displayed in correct order
      const calls: string[] = mock_output_channel.appendLine.mock.calls
        .map((call) => call[0] as string)
        .filter((line) => line.includes('article') ||
                                   line.includes('documentation') || 
                                   line.includes('other'));

      expect(calls[0]).toContain('article: 40');
      expect(calls[1]).toContain('documentation: 30');
      expect(calls[2]).toContain('other: 30');
    });

    it('should handle zero total pages gracefully', () => {
      (global_filter_metrics.get_metrics as jest.Mock).mockReturnValue({
        total_pages: 0,
        processed_pages: 0,
        filtered_pages: 0,
        average_confidence: 0,
        page_types: {},
        filter_reasons: {}
      });

      const mock_command_handler = jest.fn();
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        (command, handler) => {
          if (command === 'bergamot.showFilterMetrics') {
            mock_command_handler.mockImplementation(handler);
          }
          return { dispose: jest.fn() };
        }
      );

      command_manager.register_all();
      mock_command_handler();

      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Pages processed: 0 (0%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Pages filtered: 0 (0%)'
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
          if (command === 'bergamot.showFilterMetrics') {
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

      (global_filter_metrics.get_metrics as jest.Mock).mockReturnValue({
        total_pages: 333,
        processed_pages: 111,
        filtered_pages: 222,
        average_confidence: 0.666,
        page_types: {},
        filter_reasons: {}
      });

      command_manager.register_all();
      mock_command_handler();

      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Pages processed: 111 (33.3%)'
      );
      expect(mock_output_channel.appendLine).toHaveBeenCalledWith(
        'Pages filtered: 222 (66.7%)'
      );
    });
  });
});