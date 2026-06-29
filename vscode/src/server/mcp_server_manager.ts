import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';

export interface MCPServerConfig {
  context: vscode.ExtensionContext;
}

export class MCPServerManager {
  private mcp_process?: child_process.ChildProcess;

  constructor(private config: MCPServerConfig) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Starting MCP server process...');

        const mcp_script_path = path.join(
          this.config.context.extensionPath,
          'out',
          'mcp_server_standalone.js'
        );

        // The MCP child holds no store of its own: it serves queries over the
        // extension server's HTTP endpoints (discovered via ~/.bergamot/port.json),
        // so it needs no storage path and never touches the encrypted DB file.
        // Spawned via the host's own binary (Electron run as node) — a
        // packaged install cannot assume a `node` on the user's PATH.
        this.mcp_process = child_process.spawn(
          process.execPath,
          [mcp_script_path],
          {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          }
        );

        this.mcp_process.on('error', (error) => {
          console.error('MCP server process error:', error);
          vscode.window.showErrorMessage(
            `MCP server failed to start: ${error.message}`
          );
          reject(error);
        });

        this.mcp_process.on('exit', (code) => {
          console.log(`MCP server process exited with code ${code}`);
          this.mcp_process = undefined;
        });

        // The child sends no ready signal, so treat it as started after a
        // brief settle delay rather than blocking on a handshake.
        setTimeout(() => {
          console.log('MCP server process started successfully');
          resolve();
        }, 100);

      } catch (error) {
        console.error('Failed to start MCP server:', error);
        reject(error);
      }
    });
  }

  start_deferred(delay_ms: number = 2000): void {
    setTimeout(async () => {
      try {
        await this.start();
      } catch (error) {
        // Swallow failures during activation: an unavailable MCP server must
        // not surface errors or block the rest of the session.
        console.error('Failed to start MCP server (deferred):', error);
        console.log('MCP server will be unavailable for this session');
      }
    }, delay_ms);
  }

  async stop(): Promise<void> {
    if (this.mcp_process) {
      return new Promise((resolve) => {
        const process = this.mcp_process!;

        const cleanup = () => {
          this.mcp_process = undefined;
          resolve();
        };

        process.once('exit', cleanup);

        process.kill('SIGTERM');

        // Escalate to SIGKILL if the process ignores graceful shutdown,
        // guaranteeing the port is released.
        setTimeout(() => {
          if (this.mcp_process) {
            process.kill('SIGKILL');
            cleanup();
          }
        }, 5000);
      });
    }
  }
}
