import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import { DuckDB } from '../duck_db';

/**
 * Configuration for MCP server.
 */
export interface MCPServerConfig {
  context: vscode.ExtensionContext;
  openai_api_key: string;
  duck_db: DuckDB;
}

/**
 * Manages the MCP (Model Context Protocol) server process.
 */
export class MCPServerManager {
  private mcp_process?: child_process.ChildProcess;

  constructor(private config: MCPServerConfig) {}

  /**
   * Starts the MCP server process.
   * 
   * @returns Promise that resolves when the server is started
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Starting MCP server process...');

        const mcp_script_path = path.join(
          this.config.context.extensionPath,
          'dist',
          'mcp_server_standalone.js'
        );

        this.mcp_process = child_process.spawn('node', [mcp_script_path], {
          env: {
            ...process.env,
            OPENAI_API_KEY: this.config.openai_api_key,
            STORAGE_PATH: this.config.context.globalStorageUri.fsPath,
            DUCK_DB_PATH: path.join(
              this.config.context.globalStorageUri.fsPath,
              'webpage_categorizations.db'
            ),
          },
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });

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

        // Consider the server started after a short delay
        // Since the process doesn't send a ready signal
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

  /**
   * Starts the MCP server in a deferred manner (non-blocking).
   * Used during extension activation to avoid blocking the main thread.
   */
  start_deferred(delay_ms: number = 2000): void {
    setTimeout(async () => {
      try {
        await this.start();
      } catch (error) {
        console.error('Failed to start MCP server (deferred):', error);
        // Don't show error message for deferred initialization to avoid disrupting user
        console.log('MCP server will be unavailable for this session');
      }
    }, delay_ms);
  }

  /**
   * Stops the MCP server process.
   */
  async stop(): Promise<void> {
    if (this.mcp_process) {
      return new Promise((resolve) => {
        const process = this.mcp_process!;
        
        const cleanup = () => {
          this.mcp_process = undefined;
          resolve();
        };

        process.once('exit', cleanup);
        
        // Try graceful shutdown first
        process.kill('SIGTERM');
        
        // Force kill after timeout
        setTimeout(() => {
          if (this.mcp_process) {
            process.kill('SIGKILL');
            cleanup();
          }
        }, 5000);
      });
    }
  }

  /**
   * Checks if the MCP server is running.
   * 
   * @returns True if the server process is active
   */
  is_running(): boolean {
    return this.mcp_process !== undefined && !this.mcp_process.killed;
  }

  /**
   * Gets the MCP server process.
   * 
   * @returns The child process or undefined if not running
   */
  get_process(): child_process.ChildProcess | undefined {
    return this.mcp_process;
  }
}