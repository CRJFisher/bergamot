import * as vscode from 'vscode';
import { CommandManager, CommandConfig } from './command_manager';
import { DuckDB } from '../duck_db';
import { ServerManager } from '../server/server_manager';
import { register_webpage_hover_provider } from '../webpage_hover_provider';

// Mock dependencies
jest.mock('../webpage_hover_provider');

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

    it('should register the dev observability commands', () => {
      const mock_command = { dispose: jest.fn() };
      (vscode.commands.registerCommand as jest.Mock).mockReturnValue(mock_command);

      command_manager.register_all();

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'bergamot.showVisitOutcomes',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'bergamot.replayVisit',
        expect.any(Function)
      );
    });
  });

  describe('dispose()', () => {
    it('should dispose all registered commands', () => {
      const mock_disposable = { dispose: jest.fn() };

      (vscode.commands.registerCommand as jest.Mock).mockReturnValue(mock_disposable);

      command_manager.register_all();
      command_manager.dispose();

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
});
