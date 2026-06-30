import * as vscode from 'vscode';
import { CommandManager, CommandConfig } from './command_manager';
import { DuckDB } from '../duck_db';
import { ServerManager } from '../server/server_manager';
import { register_webpage_hover_provider } from '../webpage_hover_provider';
import { get_recent_outcomes } from '../dev_log';
import { list_replay_visits, load_replay_visit } from '../visit_replay';

jest.mock('../webpage_hover_provider');
jest.mock('../dev_log', () => ({
  get_recent_outcomes: jest.fn().mockReturnValue([]),
}));
jest.mock('../visit_replay', () => ({
  list_replay_visits: jest.fn().mockReturnValue([]),
  load_replay_visit: jest.fn(),
}));
jest.mock('../tdt/rebuild_clusters', () => ({
  default_window_spec: jest.fn().mockReturnValue({ windows: [] }),
}));

jest.mock('vscode', () => ({
  commands: {
    registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
  window: {
    createOutputChannel: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showQuickPick: jest.fn(),
    withProgress: jest.fn((_opts, task) => task()),
  },
  ProgressLocation: { Notification: 15 },
}));

/** Returns the handler registered for the first command id containing `fragment`. */
function handler_for(fragment: string): () => unknown {
  const calls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
  const entry = calls.find(([id]) => String(id).includes(fragment));
  if (!entry) throw new Error(`no command registered matching "${fragment}"`);
  return entry[1];
}

function make_config(
  server_manager: Partial<ServerManager> = {}
): CommandConfig {
  const subscriptions: vscode.Disposable[] = [];
  return {
    context: {
      subscriptions,
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext,
    duck_db: {} as DuckDB,
    server_manager: {
      get_queue_processor: jest.fn().mockReturnValue(undefined),
      ...server_manager,
    } as Partial<ServerManager> as ServerManager,
    storage_base: '/test/storage',
  };
}

describe('CommandManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window.withProgress as jest.Mock).mockImplementation((_o, task) =>
      task()
    );
  });

  describe('register_all', () => {
    it('registers the hover provider and every extension command exactly once', () => {
      const manager = new CommandManager(make_config());
      manager.register_all();

      expect(register_webpage_hover_provider).toHaveBeenCalledTimes(1);

      const ids = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(
        ([id]) => id
      );
      const expected = [
        'bergamot.forget',
        'bergamot.tdt.embedPages',
        'bergamot.tdt.rebuildClusters',
        'bergamot.showVisitOutcomes',
        'bergamot.replayVisit',
      ];
      for (const id of expected) {
        expect(ids.filter((registered) => registered === id)).toHaveLength(1);
      }
    });

    it('pushes each registration onto the context subscriptions for host cleanup', () => {
      const config = make_config();
      const manager = new CommandManager(config);
      manager.register_all();

      // Five registered commands; hover provider manages its own subscription.
      expect(config.context.subscriptions).toHaveLength(5);
    });
  });

  describe('dispose', () => {
    it('disposes every registered command', () => {
      const disposables = Array.from({ length: 5 }, () => ({
        dispose: jest.fn(),
      }));
      let next = 0;
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(
        () => disposables[next++]
      );

      const manager = new CommandManager(make_config());
      manager.register_all();
      manager.dispose();

      for (const d of disposables) {
        expect(d.dispose).toHaveBeenCalledTimes(1);
      }
    });

    it('clears the disposables so a second dispose is a no-op', () => {
      const disposables: { dispose: jest.Mock }[] = [];
      (vscode.commands.registerCommand as jest.Mock).mockImplementation(() => {
        const d = { dispose: jest.fn() };
        disposables.push(d);
        return d;
      });

      const manager = new CommandManager(make_config());
      manager.register_all();
      manager.dispose();
      manager.dispose();

      for (const d of disposables) {
        expect(d.dispose).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('rebuild clusters command', () => {
    it('reports the clustered-window count and corpus totals on success', async () => {
      const rebuild_clusters = jest.fn().mockResolvedValue({
        total_visits: 42,
        excluded_origins: 3,
        windows: [{ status: 'clustered' }, { status: 'skipped' }],
      });
      const manager = new CommandManager(make_config({ rebuild_clusters }));
      manager.register_all();

      await handler_for('rebuildClusters')();

      expect(rebuild_clusters).toHaveBeenCalledTimes(1);
      const message = (vscode.window.showInformationMessage as jest.Mock).mock
        .calls[0][0];
      expect(message).toContain('clustered 1 window(s)');
      expect(message).toContain('42 visit(s)');
      expect(message).toContain('2 window(s) in range');
      expect(message).toContain('3 blocked origin(s)');
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('surfaces a failure as an error message rather than throwing', async () => {
      const rebuild_clusters = jest
        .fn()
        .mockRejectedValue(new Error('worker died'));
      const manager = new CommandManager(make_config({ rebuild_clusters }));
      manager.register_all();

      await expect(handler_for('rebuildClusters')()).resolves.toBeUndefined();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Bergamot: clustering run failed — worker died'
      );
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });
  });

  describe('embed pages command', () => {
    it('reports per-page tallies on success', async () => {
      const embed_pages = jest.fn().mockResolvedValue({
        embedded: 5,
        skipped: 2,
        excluded: 1,
        failed: 0,
        scanned: 8,
      });
      const manager = new CommandManager(make_config({ embed_pages }));
      manager.register_all();

      await handler_for('embedPages')();

      expect(embed_pages).toHaveBeenCalledTimes(1);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Bergamot: embedded 5, skipped 2, excluded 1, failed 0 (of 8 page(s)).'
      );
    });

    it('surfaces a failure as an error message rather than throwing', async () => {
      const embed_pages = jest
        .fn()
        .mockRejectedValue(new Error('model load failed'));
      const manager = new CommandManager(make_config({ embed_pages }));
      manager.register_all();

      await expect(handler_for('embedPages')()).resolves.toBeUndefined();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Bergamot: embed pass failed — model load failed'
      );
    });
  });

  describe('show visit outcomes command', () => {
    it('renders pipeline counts and outcomes into a reused output channel', () => {
      (get_recent_outcomes as jest.Mock).mockReturnValue([
        { decision: 'dropped', url: 'https://x', visit_id: 'v1', reason: 'login_wall' },
      ]);
      const channel = {
        clear: jest.fn(),
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
      };
      (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(channel);

      const get_stats = jest.fn().mockReturnValue({
        queue_length: 4,
        is_processing: true,
        orphan_stats: { total_orphans: 2 },
      });
      const manager = new CommandManager(
        make_config({
          get_queue_processor: jest.fn().mockReturnValue({ get_stats }),
        })
      );
      manager.register_all();

      handler_for('showVisitOutcomes')();
      handler_for('showVisitOutcomes')();

      expect(vscode.window.createOutputChannel).toHaveBeenCalledTimes(1);
      const rendered = channel.appendLine.mock.calls[0][0];
      expect(rendered).toContain('Queue length: 4');
      expect(rendered).toContain('Orphans: 2');
      expect(rendered).toContain('[dropped] https://x (v1) reason=login_wall');
      // Visit Outcomes channel must be the last shown so it remains visible.
      expect(channel.show).toHaveBeenCalledTimes(2);
    });

    it('renders zeroed counts when no queue processor is running', () => {
      const channel = {
        clear: jest.fn(),
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
      };
      (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(channel);
      (get_recent_outcomes as jest.Mock).mockReturnValue([]);

      const manager = new CommandManager(make_config());
      manager.register_all();

      handler_for('showVisitOutcomes')();

      const rendered = channel.appendLine.mock.calls[0][0];
      expect(rendered).toContain('Queue length: 0');
      expect(rendered).toContain('Processing: false');
      expect(rendered).toContain('Orphans: 0');
    });
  });

  describe('replay visit command', () => {
    it('reports nothing to replay when no persisted visits exist', async () => {
      (list_replay_visits as jest.Mock).mockReturnValue([]);
      const manager = new CommandManager(make_config());
      manager.register_all();

      await handler_for('replayVisit')();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Bergamot: no visits to replay.'
      );
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('enqueues the chosen visit into the live queue processor', async () => {
      (list_replay_visits as jest.Mock).mockReturnValue([
        { url: 'https://x', visit_id: 'v1', page_loaded_at: 't' },
      ]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
        visit_id: 'v1',
      });
      const visit = { url: 'https://x', visit_id: 'v1' };
      (load_replay_visit as jest.Mock).mockReturnValue(visit);
      const enqueue = jest.fn();
      const manager = new CommandManager(
        make_config({
          get_queue_processor: jest.fn().mockReturnValue({ enqueue }),
        })
      );
      manager.register_all();

      await handler_for('replayVisit')();

      expect(enqueue).toHaveBeenCalledWith(visit);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Bergamot: replaying https://x'
      );
    });

    it('warns and does not enqueue when the visit was evicted before replay', async () => {
      (list_replay_visits as jest.Mock).mockReturnValue([
        { url: 'https://x', visit_id: 'v1', page_loaded_at: 't' },
      ]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
        visit_id: 'v1',
      });
      (load_replay_visit as jest.Mock).mockReturnValue(null);
      const enqueue = jest.fn();
      const manager = new CommandManager(
        make_config({
          get_queue_processor: jest.fn().mockReturnValue({ enqueue }),
        })
      );
      manager.register_all();

      await handler_for('replayVisit')();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Bergamot: visit was evicted before replay.'
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('warns when the server is not running', async () => {
      (list_replay_visits as jest.Mock).mockReturnValue([
        { url: 'https://x', visit_id: 'v1', page_loaded_at: 't' },
      ]);
      (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
        visit_id: 'v1',
      });
      (load_replay_visit as jest.Mock).mockReturnValue({
        url: 'https://x',
        visit_id: 'v1',
      });
      const manager = new CommandManager(
        make_config({
          get_queue_processor: jest.fn().mockReturnValue(undefined),
        })
      );
      manager.register_all();

      await handler_for('replayVisit')();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Bergamot: server not running; cannot replay.'
      );
    });
  });
});
