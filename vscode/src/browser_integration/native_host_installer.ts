/**
 * Native host installation and manifest configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { BrowserInfo, BrowserType, NativeHostManifest, PlatformPaths, EXTENSION_IDS } from './models';

/**
 * Handles installation of the Node.js native messaging host
 */
export class NativeHostInstaller {
  private platform: NodeJS.Platform;
  private nativeHostName = 'com.pkm_assistant.native';

  constructor(private context: vscode.ExtensionContext) {
    this.platform = process.platform;
  }

  /**
   * Installs the native host for the specified browser
   */
  async install(browser: BrowserInfo): Promise<{ manifestPath: string; hostPath: string }> {
    // Step 1: Create directories
    const paths = this.get_platform_paths();
    await this.create_directories(paths);

    // Step 2: Copy native host script
    const hostPath = await this.install_native_host_script(paths.nativeHostDir);

    // Step 3: Create and write manifest
    const manifestPath = await this.install_manifest(browser, paths, hostPath);

    return { manifestPath, hostPath };
  }

  /**
   * Checks if native host is already installed
   */
  async is_installed(): Promise<boolean> {
    const paths = this.get_platform_paths();
    const hostPath = path.join(paths.nativeHostDir, 'native_host.js');
    
    // Check if native host script exists
    if (!fs.existsSync(hostPath)) {
      return false;
    }

    // Check if at least one manifest exists
    const manifestPaths = [
      paths.chromeManifestDir,
      paths.firefoxManifestDir,
      paths.edgeManifestDir
    ].filter(p => p !== undefined);

    for (const dir of manifestPaths) {
      const manifestPath = path.join(dir!, `${this.nativeHostName}.json`);
      if (fs.existsSync(manifestPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Uninstalls the native host
   */
  async uninstall(): Promise<void> {
    const paths = this.get_platform_paths();

    // Remove native host script
    const hostPath = path.join(paths.nativeHostDir, 'native_host.js');
    if (fs.existsSync(hostPath)) {
      await fs.promises.unlink(hostPath);
    }

    // Remove manifests
    const manifestPaths = [
      paths.chromeManifestDir,
      paths.firefoxManifestDir,
      paths.edgeManifestDir
    ].filter(p => p !== undefined);

    for (const dir of manifestPaths) {
      const manifestPath = path.join(dir!, `${this.nativeHostName}.json`);
      if (fs.existsSync(manifestPath)) {
        await fs.promises.unlink(manifestPath);
      }
    }

    // Remove directory if empty
    try {
      const files = await fs.promises.readdir(paths.nativeHostDir);
      if (files.length === 0) {
        await fs.promises.rmdir(paths.nativeHostDir);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Gets platform-specific paths for installation
   */
  private get_platform_paths(): PlatformPaths {
    const homeDir = os.homedir();

    switch (this.platform) {
      case 'darwin':
        return {
          nativeHostDir: path.join(homeDir, '.pkm-assistant'),
          chromeManifestDir: path.join(homeDir, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
          firefoxManifestDir: path.join(homeDir, 'Library/Application Support/Mozilla/NativeMessagingHosts'),
          edgeManifestDir: path.join(homeDir, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts')
        };

      case 'win32':
        return {
          nativeHostDir: path.join(homeDir, '.pkm-assistant'),
          // On Windows, we'll use registry for Chrome/Edge, but still need file paths for Firefox
          firefoxManifestDir: path.join(homeDir, 'AppData/Roaming/Mozilla/NativeMessagingHosts')
        };

      case 'linux':
        return {
          nativeHostDir: path.join(homeDir, '.pkm-assistant'),
          chromeManifestDir: path.join(homeDir, '.config/google-chrome/NativeMessagingHosts'),
          firefoxManifestDir: path.join(homeDir, '.mozilla/native-messaging-hosts'),
          edgeManifestDir: path.join(homeDir, '.config/microsoft-edge/NativeMessagingHosts')
        };

      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Creates necessary directories
   */
  private async create_directories(paths: PlatformPaths): Promise<void> {
    // Create native host directory
    await fs.promises.mkdir(paths.nativeHostDir, { recursive: true });

    // Create manifest directories
    const dirs = [
      paths.chromeManifestDir,
      paths.firefoxManifestDir,
      paths.edgeManifestDir
    ].filter(d => d !== undefined);

    for (const dir of dirs) {
      await fs.promises.mkdir(dir!, { recursive: true });
    }
  }

  /**
   * Installs the native host script
   */
  private async install_native_host_script(targetDir: string): Promise<string> {
    const sourcePath = path.join(this.context.extensionPath, 'resources', 'native_host.js');
    const targetPath = path.join(targetDir, 'native_host.js');

    // Copy the script
    await fs.promises.copyFile(sourcePath, targetPath);

    // Make executable on Unix-like systems
    if (this.platform !== 'win32') {
      await fs.promises.chmod(targetPath, 0o755);
    }

    return targetPath;
  }

  /**
   * Installs the native messaging manifest
   */
  private async install_manifest(
    browser: BrowserInfo,
    paths: PlatformPaths,
    hostPath: string
  ): Promise<string> {
    // Create manifest
    const manifest = this.create_manifest(browser, hostPath);

    // Determine manifest directory based on browser
    let manifestDir: string | undefined;
    switch (browser.type) {
      case BrowserType.CHROME:
      case BrowserType.BRAVE:
        manifestDir = paths.chromeManifestDir;
        break;
      case BrowserType.FIREFOX:
        manifestDir = paths.firefoxManifestDir;
        break;
      case BrowserType.EDGE:
        manifestDir = paths.edgeManifestDir || paths.chromeManifestDir;
        break;
      case BrowserType.OPERA:
        manifestDir = paths.chromeManifestDir;
        break;
    }

    if (!manifestDir) {
      throw new Error(`No manifest directory for browser: ${browser.type}`);
    }

    const manifestPath = path.join(manifestDir, `${this.nativeHostName}.json`);

    // Write manifest
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    // On Windows, also register in registry for Chrome/Edge
    if (this.platform === 'win32' && browser.type !== BrowserType.FIREFOX) {
      await this.register_windows_manifest(manifestPath);
    }

    return manifestPath;
  }

  /**
   * Creates the native host manifest
   */
  private create_manifest(browser: BrowserInfo, hostPath: string): NativeHostManifest {
    // Get Node.js executable path
    const nodePath = this.get_node_path();

    // Get extension ID for this browser
    const extensionId = EXTENSION_IDS[browser.type];

    // Create manifest based on browser type
    const manifest: NativeHostManifest = {
      name: this.nativeHostName,
      description: 'PKM Assistant Native Messaging Host',
      path: nodePath,
      args: [hostPath],
      type: 'stdio'
    };

    // Firefox uses 'allowed_extensions', Chrome uses 'allowed_origins'
    if (browser.type === BrowserType.FIREFOX) {
      manifest.allowed_extensions = [extensionId];
    } else {
      // Chrome, Edge, Brave, Opera use origin format
      manifest.allowed_origins = [`chrome-extension://${extensionId}/`];
    }

    return manifest;
  }

  /**
   * Gets the path to Node.js executable
   */
  private get_node_path(): string {
    // Try to use VS Code's Node.js first (it's signed)
    if (process.execPath && process.execPath.includes('Code')) {
      return process.execPath;
    }

    // Fallback to system Node.js
    switch (this.platform) {
      case 'darwin':
      case 'linux': {
        // Try common locations
        const paths = ['/usr/local/bin/node', '/usr/bin/node'];
        for (const p of paths) {
          if (fs.existsSync(p)) {
            return p;
          }
        }
        // Last resort: use 'node' and hope it's in PATH
        return 'node';
      }

      case 'win32': {
        // Try to find Node.js in Program Files
        const programFiles = [
          process.env['ProgramFiles'],
          process.env['ProgramFiles(x86)']
        ].filter(p => p !== undefined);

        for (const pf of programFiles) {
          const nodePath = path.join(pf!, 'nodejs', 'node.exe');
          if (fs.existsSync(nodePath)) {
            return nodePath;
          }
        }
        // Fallback to PATH
        return 'node.exe';
      }

      default:
        return 'node';
    }
  }

  /**
   * Registers the manifest in Windows registry
   */
  private async register_windows_manifest(manifestPath: string): Promise<void> {
    // This would require running reg.exe commands or using a native module
    // For now, we'll just rely on the file-based approach which works for Firefox
    // and newer versions of Chrome/Edge

    // TODO: Implement registry registration for better Windows support
    console.log('Windows registry registration not yet implemented');
  }
}