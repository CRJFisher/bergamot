/**
 * Browser detection and information gathering
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BrowserInfo, BrowserType, EXTENSION_STORES, EXTENSION_IDS } from './models';

const execAsync = promisify(exec);

/**
 * Detects installed browsers and their configurations
 */
export class BrowserDetector {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = process.platform;
  }

  /**
   * Detects all installed browsers on the system
   */
  async detect_all_browsers(): Promise<BrowserInfo[]> {
    const browsers: BrowserInfo[] = [];

    // Check each browser type
    for (const browserType of Object.values(BrowserType)) {
      const browser = await this.detect_browser(browserType);
      if (browser) {
        browsers.push(browser);
      }
    }

    // Detect default browser
    if (browsers.length > 0) {
      const defaultBrowser = await this.detect_default_browser();
      browsers.forEach(b => {
        b.isDefault = b.type === defaultBrowser;
      });
    }

    return browsers;
  }

  /**
   * Detects a specific browser
   */
  private async detect_browser(type: BrowserType): Promise<BrowserInfo | null> {
    switch (this.platform) {
      case 'darwin':
        return this.detect_browser_macos(type);
      case 'win32':
        return this.detect_browser_windows(type);
      case 'linux':
        return this.detect_browser_linux(type);
      default:
        return null;
    }
  }

  /**
   * Detects browser on macOS
   */
  private async detect_browser_macos(type: BrowserType): Promise<BrowserInfo | null> {
    const appPaths: Record<BrowserType, string> = {
      [BrowserType.CHROME]: '/Applications/Google Chrome.app',
      [BrowserType.FIREFOX]: '/Applications/Firefox.app',
      [BrowserType.EDGE]: '/Applications/Microsoft Edge.app',
      [BrowserType.BRAVE]: '/Applications/Brave Browser.app',
      [BrowserType.OPERA]: '/Applications/Opera.app'
    };

    const appPath = appPaths[type];
    if (!appPath || !fs.existsSync(appPath)) {
      return null;
    }

    // Get version
    let version = 'unknown';
    try {
      const plistPath = path.join(appPath, 'Contents/Info.plist');
      const { stdout } = await execAsync(
        `defaults read "${plistPath}" CFBundleShortVersionString`
      );
      version = stdout.trim();
    } catch {
      // Ignore version detection errors
    }

    // Get profile path
    const profilePaths: Record<BrowserType, string> = {
      [BrowserType.CHROME]: path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
      [BrowserType.FIREFOX]: path.join(os.homedir(), 'Library/Application Support/Firefox'),
      [BrowserType.EDGE]: path.join(os.homedir(), 'Library/Application Support/Microsoft Edge'),
      [BrowserType.BRAVE]: path.join(os.homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser'),
      [BrowserType.OPERA]: path.join(os.homedir(), 'Library/Application Support/com.operasoftware.Opera')
    };

    return {
      type,
      name: this.get_browser_display_name(type),
      version,
      executablePath: path.join(appPath, 'Contents/MacOS', this.get_executable_name(type)),
      profilePath: profilePaths[type],
      isDefault: false,
      supportsNativeMessaging: true,
      extensionStoreUrl: EXTENSION_STORES[type],
      extensionId: EXTENSION_IDS[type]
    };
  }

  /**
   * Detects browser on Windows
   */
  private async detect_browser_windows(type: BrowserType): Promise<BrowserInfo | null> {
    const registryPaths: Record<BrowserType, string> = {
      [BrowserType.CHROME]: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      [BrowserType.FIREFOX]: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe',
      [BrowserType.EDGE]: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
      [BrowserType.BRAVE]: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe',
      [BrowserType.OPERA]: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\opera.exe'
    };

    try {
      const { stdout } = await execAsync(
        `reg query "${registryPaths[type]}" /ve`
      );
      
      const match = stdout.match(/REG_SZ\s+(.+)/);
      if (!match) {
        return null;
      }

      const executablePath = match[1].trim();
      if (!fs.existsSync(executablePath)) {
        return null;
      }

      // Get version
      let version = 'unknown';
      try {
        const { stdout: versionOutput } = await execAsync(
          `wmic datafile where name="${executablePath.replace(/\\/g, '\\\\')}" get Version /value`
        );
        const versionMatch = versionOutput.match(/Version=(.+)/);
        if (versionMatch) {
          version = versionMatch[1].trim();
        }
      } catch {
        // Ignore version detection errors
      }

      // Get profile path
      const profilePaths: Record<BrowserType, string> = {
        [BrowserType.CHROME]: path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data'),
        [BrowserType.FIREFOX]: path.join(os.homedir(), 'AppData/Roaming/Mozilla/Firefox'),
        [BrowserType.EDGE]: path.join(os.homedir(), 'AppData/Local/Microsoft/Edge/User Data'),
        [BrowserType.BRAVE]: path.join(os.homedir(), 'AppData/Local/BraveSoftware/Brave-Browser/User Data'),
        [BrowserType.OPERA]: path.join(os.homedir(), 'AppData/Roaming/Opera Software/Opera Stable')
      };

      return {
        type,
        name: this.get_browser_display_name(type),
        version,
        executablePath,
        profilePath: profilePaths[type],
        isDefault: false,
        supportsNativeMessaging: true,
        extensionStoreUrl: EXTENSION_STORES[type],
        extensionId: EXTENSION_IDS[type]
      };
    } catch {
      return null;
    }
  }

  /**
   * Detects browser on Linux
   */
  private async detect_browser_linux(type: BrowserType): Promise<BrowserInfo | null> {
    const commands: Record<BrowserType, string> = {
      [BrowserType.CHROME]: 'google-chrome',
      [BrowserType.FIREFOX]: 'firefox',
      [BrowserType.EDGE]: 'microsoft-edge',
      [BrowserType.BRAVE]: 'brave-browser',
      [BrowserType.OPERA]: 'opera'
    };

    try {
      const { stdout } = await execAsync(`which ${commands[type]}`);
      const executablePath = stdout.trim();
      
      if (!executablePath) {
        return null;
      }

      // Get version
      let version = 'unknown';
      try {
        const { stdout: versionOutput } = await execAsync(
          `${commands[type]} --version`
        );
        const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          version = versionMatch[1];
        }
      } catch {
        // Ignore version detection errors
      }

      // Get profile path
      const profilePaths: Record<BrowserType, string> = {
        [BrowserType.CHROME]: path.join(os.homedir(), '.config/google-chrome'),
        [BrowserType.FIREFOX]: path.join(os.homedir(), '.mozilla/firefox'),
        [BrowserType.EDGE]: path.join(os.homedir(), '.config/microsoft-edge'),
        [BrowserType.BRAVE]: path.join(os.homedir(), '.config/BraveSoftware/Brave-Browser'),
        [BrowserType.OPERA]: path.join(os.homedir(), '.config/opera')
      };

      return {
        type,
        name: this.get_browser_display_name(type),
        version,
        executablePath,
        profilePath: profilePaths[type],
        isDefault: false,
        supportsNativeMessaging: true,
        extensionStoreUrl: EXTENSION_STORES[type],
        extensionId: EXTENSION_IDS[type]
      };
    } catch {
      return null;
    }
  }

  /**
   * Detects the system's default browser
   */
  private async detect_default_browser(): Promise<BrowserType | null> {
    try {
      switch (this.platform) {
        case 'darwin': {
          const { stdout } = await execAsync(
            'defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep -A 2 "https" | grep BundleIdentifier'
          );
          if (stdout.includes('com.google.Chrome')) return BrowserType.CHROME;
          if (stdout.includes('org.mozilla.firefox')) return BrowserType.FIREFOX;
          if (stdout.includes('com.microsoft.edgemac')) return BrowserType.EDGE;
          if (stdout.includes('com.brave.Browser')) return BrowserType.BRAVE;
          if (stdout.includes('com.operasoftware.Opera')) return BrowserType.OPERA;
          break;
        }
        case 'win32': {
          const { stdout } = await execAsync(
            'reg query HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice /v ProgId'
          );
          if (stdout.includes('ChromeHTML')) return BrowserType.CHROME;
          if (stdout.includes('FirefoxURL')) return BrowserType.FIREFOX;
          if (stdout.includes('MSEdgeHTM')) return BrowserType.EDGE;
          if (stdout.includes('BraveHTML')) return BrowserType.BRAVE;
          if (stdout.includes('OperaStable')) return BrowserType.OPERA;
          break;
        }
        case 'linux': {
          const { stdout } = await execAsync('xdg-settings get default-web-browser');
          if (stdout.includes('chrome')) return BrowserType.CHROME;
          if (stdout.includes('firefox')) return BrowserType.FIREFOX;
          if (stdout.includes('edge')) return BrowserType.EDGE;
          if (stdout.includes('brave')) return BrowserType.BRAVE;
          if (stdout.includes('opera')) return BrowserType.OPERA;
          break;
        }
      }
    } catch {
      // Ignore errors in default browser detection
    }
    return null;
  }

  /**
   * Gets the display name for a browser type
   */
  private get_browser_display_name(type: BrowserType): string {
    const names: Record<BrowserType, string> = {
      [BrowserType.CHROME]: 'Google Chrome',
      [BrowserType.FIREFOX]: 'Mozilla Firefox',
      [BrowserType.EDGE]: 'Microsoft Edge',
      [BrowserType.BRAVE]: 'Brave Browser',
      [BrowserType.OPERA]: 'Opera'
    };
    return names[type];
  }

  /**
   * Gets the executable name for a browser on macOS
   */
  private get_executable_name(type: BrowserType): string {
    const names: Record<BrowserType, string> = {
      [BrowserType.CHROME]: 'Google Chrome',
      [BrowserType.FIREFOX]: 'firefox',
      [BrowserType.EDGE]: 'Microsoft Edge',
      [BrowserType.BRAVE]: 'Brave Browser',
      [BrowserType.OPERA]: 'Opera'
    };
    return names[type];
  }
}