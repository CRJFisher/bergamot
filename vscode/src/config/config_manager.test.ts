import * as vscode from 'vscode';
import { ConfigManager } from './config_manager';

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn()
  }
}));

function mock_config(values: Record<string, unknown>): void {
  const config = {
    get: jest.fn((key: string, default_value: unknown) =>
      key in values ? values[key] : default_value
    )
  };
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(config);
}

describe('ConfigManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get_dev_mode()', () => {
    it('defaults to false when devMode is unset', () => {
      mock_config({});
      expect(ConfigManager.get_dev_mode()).toBe(false);
    });

    it('returns the configured value when devMode is set', () => {
      mock_config({ devMode: true });
      expect(ConfigManager.get_dev_mode()).toBe(true);
    });

    it('reads from the bergamot namespace', () => {
      mock_config({});
      ConfigManager.get_dev_mode();
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('bergamot');
    });
  });

  describe('get_cluster_cadence_hours()', () => {
    it('defaults to 24 hours when the setting is unset', () => {
      mock_config({});
      expect(ConfigManager.get_cluster_cadence_hours()).toBe(24);
    });

    it('returns the configured cadence when set', () => {
      mock_config({ 'tdt.clusterCadenceHours': 6 });
      expect(ConfigManager.get_cluster_cadence_hours()).toBe(6);
    });

    it('returns 0 when the automatic run is disabled', () => {
      mock_config({ 'tdt.clusterCadenceHours': 0 });
      expect(ConfigManager.get_cluster_cadence_hours()).toBe(0);
    });

    it('reads from the bergamot namespace', () => {
      mock_config({});
      ConfigManager.get_cluster_cadence_hours();
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('bergamot');
    });
  });
});
