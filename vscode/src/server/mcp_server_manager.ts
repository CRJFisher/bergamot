import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';

/**
 * Configuration for MCP server.
 * Contains dependencies required to run the Model Context Protocol server.
 * 
 * @interface MCPServerConfig
 * @property {vscode.ExtensionContext} context - VS Code extension context for paths and storage
 * @property {string} storage_base - Resolved storage base (dev or global) shared with the writer.
 *   The child process opens its own read-only stores from this path.
 */
export interface MCPServerConfig {
  context: vscode.ExtensionContext;
  storage_base: string;
}

/**
 * Manages the MCP (Model Context Protocol) server process.
 * The MCP server provides external tool access for AI assistants to query
 * and analyze the stored webpage data.
 * 
 * @example
 * ```typescript
 * const mcpManager = new MCPServerManager({
 *   context: extensionContext,
 *   storage_base: '/path/to/storage'
 * });
 * 
 * // Start immediately
 * await mcpManager.start();
 * 
 * // Or start with delay (non-blocking)
 * mcpManager.start_deferred(2000);
 * 
 * // Check status
 * if (mcpManager.is_running()) {
 *   console.log('MCP server is running');
 * }
 * 
 * // Clean up
 * await mcpManager.stop();
 * ```
 */
export class MCPServerManager {
  private mcp_process?: child_process.ChildProcess;

  constructor(private config: MCPServerConfig) {}

  /**
   * Starts the MCP server process.
   * Spawns a Node.js child process running the MCP server script.
   * 
   * @returns Promise that resolves when the server is started
   * @throws {Error} If the server process fails to start
   * @example
   * ```typescript
   * try {
   *   await mcpManager.start();
   *   console.log('MCP server started successfully');
   * } catch (error) {
   *   console.error('Failed to start MCP server:', error);
   * }
   * ```
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Starting MCP server process...');

        const mcp_script_path = path.join(
          this.config.context.extensionPath,
          'out',
          'mcp_server_standalone.js'
        );

        this.mcp_process = child_process.spawn('node', [mcp_script_path], {
          env: {
            ...process.env,
            STORAGE_PATH: this.config.storage_base,
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
   * Errors are logged but not thrown to avoid disrupting the user experience.
   * 
   * @param delay_ms - Delay in milliseconds before starting (default: 2000ms)
   * @example
   * ```typescript
   * // Start MCP server 2 seconds after extension activation
   * mcpManager.start_deferred(2000);
   * // Extension continues initializing without waiting
   * ```
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
   * Attempts graceful shutdown with SIGTERM, then forces with SIGKILL if needed.
   * 
   * @returns Promise that resolves when the server is stopped
   * @example
   * ```typescript
   * await mcpManager.stop();
   * console.log('MCP server stopped');
   * ```
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
   * @returns True if the server process is active, false otherwise
   * @example
   * ```typescript
   * if (mcpManager.is_running()) {
   *   console.log('MCP server is active');
   * } else {
   *   console.log('MCP server is not running');
   * }
   * ```
   */
  is_running(): boolean {
    return this.mcp_process !== undefined && !this.mcp_process.killed;
  }

  /**
   * Gets the MCP server process.
   * Provides direct access to the child process for advanced monitoring.
   * 
   * @returns The child process or undefined if not running
   * @example
   * ```typescript
   * const process = mcpManager.get_process();
   * if (process) {
   *   console.log(`MCP server PID: ${process.pid}`);
   * }
   * ```
   */
  get_process(): child_process.ChildProcess | undefined {
    return this.mcp_process;
  }
}