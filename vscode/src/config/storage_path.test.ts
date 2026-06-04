import * as fs from 'fs';
import * as vscode from 'vscode';
import { get_storage_base } from './storage_path';

jest.mock('fs');

describe('get_storage_base', () => {
  const mkdir_spy = fs.mkdirSync as jest.Mock;
  const original_env = process.env.BERGAMOT_STORAGE_PATH;

  const make_context = (global_path: string): vscode.ExtensionContext =>
    ({
      globalStorageUri: { fsPath: global_path },
    } as Partial<vscode.ExtensionContext> as vscode.ExtensionContext);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BERGAMOT_STORAGE_PATH;
  });

  afterAll(() => {
    if (original_env === undefined) {
      delete process.env.BERGAMOT_STORAGE_PATH;
    } else {
      process.env.BERGAMOT_STORAGE_PATH = original_env;
    }
  });

  it('uses BERGAMOT_STORAGE_PATH when set (dev/F5 runs)', () => {
    process.env.BERGAMOT_STORAGE_PATH = '/repo/.dev-storage';

    const base = get_storage_base(make_context('/global/storage'));

    expect(base).toBe('/repo/.dev-storage');
    expect(mkdir_spy).toHaveBeenCalledWith('/repo/.dev-storage', {
      recursive: true,
    });
  });

  it('falls back to globalStorageUri when the env var is unset', () => {
    const base = get_storage_base(make_context('/global/storage'));

    expect(base).toBe('/global/storage');
    expect(mkdir_spy).toHaveBeenCalledWith('/global/storage', {
      recursive: true,
    });
  });
});
