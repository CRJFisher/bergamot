/**
 * Connection verification for browser integration
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BrowserInfo } from './models';

const execAsync = promisify(exec);

/**
 * Verifies that the browser integration is working correctly
 */
export class ConnectionVerifier {
  private testServer?: http.Server;
  private connectionReceived = false;

  /**
   * Performs a complete end-to-end verification
   */
  async verify_connection(timeout: number = 30000): Promise<boolean> {
    try {
      // Step 1: Check native host is installed
      const nativeHostExists = await this.check_native_host();
      if (!nativeHostExists) {
        throw new Error('Native host not installed');
      }

      // Step 2: Check VS Code server is running
      const serverRunning = await this.check_vscode_server();
      if (!serverRunning) {
        throw new Error('VS Code server not running');
      }

      // Step 3: Try to communicate through native host
      const canCommunicate = await this.test_native_messaging(timeout);
      if (!canCommunicate) {
        throw new Error('Native messaging communication failed');
      }

      return true;
    } catch (error) {
      console.error('Connection verification failed:', error);
      return false;
    }
  }

  /**
   * Waits for the browser extension to connect
   */
  async wait_for_extension(timeout: number = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      // Create a test server to listen for extension connections
      this.testServer = http.createServer((req, res) => {
        if (req.url === '/extension-check' && req.method === 'POST') {
          this.connectionReceived = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'connected' }));
          resolve(true);
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      // Start listening on a random port
      this.testServer.listen(0, () => {
        const port = (this.testServer!.address() as any).port;
        console.log(`Verification server listening on port ${port}`);
        
        // Write port to temp file for extension to find
        const portFile = path.join(os.tmpdir(), 'pkm_assistant_verify_port.txt');
        fs.writeFileSync(portFile, port.toString());
      });

      // Set timeout
      setTimeout(() => {
        if (!this.connectionReceived) {
          this.cleanup();
          resolve(false);
        }
      }, timeout);
    });
  }

  /**
   * Checks if the native host is installed
   */
  private async check_native_host(): Promise<boolean> {
    const hostPath = path.join(os.homedir(), '.pkm-assistant', 'native_host.js');
    return fs.existsSync(hostPath);
  }

  /**
   * Checks if the VS Code server is running
   */
  private async check_vscode_server(): Promise<boolean> {
    const portFile = path.join(os.homedir(), '.pkm-assistant', 'port.json');
    
    if (!fs.existsSync(portFile)) {
      return false;
    }

    try {
      const portData = JSON.parse(fs.readFileSync(portFile, 'utf8'));
      const port = portData.port;

      // Try to connect to the server
      return new Promise((resolve) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port,
            path: '/status',
            method: 'GET',
            timeout: 2000
          },
          (res) => {
            resolve(res.statusCode === 200);
          }
        );

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.end();
      });
    } catch {
      return false;
    }
  }

  /**
   * Tests native messaging communication
   */
  private async test_native_messaging(timeout: number): Promise<boolean> {
    // This would ideally send a test message through the native host
    // For now, we'll just verify the components are in place
    
    const platform = process.platform;
    
    // Check if manifest is installed
    let manifestPath: string;
    switch (platform) {
      case 'darwin':
        manifestPath = path.join(
          os.homedir(),
          'Library/Application Support/Google/Chrome/NativeMessagingHosts',
          'com.pkm_assistant.native.json'
        );
        break;
      case 'win32':
        manifestPath = path.join(
          os.homedir(),
          'AppData/Roaming/Mozilla/NativeMessagingHosts',
          'com.pkm_assistant.native.json'
        );
        break;
      case 'linux':
        manifestPath = path.join(
          os.homedir(),
          '.config/google-chrome/NativeMessagingHosts',
          'com.pkm_assistant.native.json'
        );
        break;
      default:
        return false;
    }

    if (!fs.existsSync(manifestPath)) {
      // Try Firefox path as fallback
      const firefoxPaths: Record<string, string> = {
        darwin: path.join(os.homedir(), 'Library/Application Support/Mozilla/NativeMessagingHosts', 'com.pkm_assistant.native.json'),
        win32: path.join(os.homedir(), 'AppData/Roaming/Mozilla/NativeMessagingHosts', 'com.pkm_assistant.native.json'),
        linux: path.join(os.homedir(), '.mozilla/native-messaging-hosts', 'com.pkm_assistant.native.json')
      };

      manifestPath = firefoxPaths[platform];
      if (!fs.existsSync(manifestPath)) {
        return false;
      }
    }

    // Verify manifest points to valid Node.js and script
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      
      // Check if Node.js path exists
      if (!fs.existsSync(manifest.path)) {
        return false;
      }

      // Check if native host script exists
      if (manifest.args && manifest.args[0]) {
        if (!fs.existsSync(manifest.args[0])) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleans up resources
   */
  cleanup(): void {
    if (this.testServer) {
      this.testServer.close();
      this.testServer = undefined;
    }

    // Clean up temp port file
    const portFile = path.join(os.tmpdir(), 'pkm_assistant_verify_port.txt');
    if (fs.existsSync(portFile)) {
      try {
        fs.unlinkSync(portFile);
      } catch {
        // Ignore errors
      }
    }
  }
}