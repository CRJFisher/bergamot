/**
 * Data models and types for browser integration setup
 */

/**
 * Supported browser types
 */
export enum BrowserType {
  CHROME = 'chrome',
  FIREFOX = 'firefox',
  EDGE = 'edge',
  BRAVE = 'brave',
  OPERA = 'opera'
}

/**
 * Information about an installed browser
 */
export interface BrowserInfo {
  type: BrowserType;
  name: string;
  version: string;
  executablePath: string;
  profilePath: string;
  isDefault: boolean;
  supportsNativeMessaging: boolean;
  extensionStoreUrl?: string;
  extensionId?: string;
}

/**
 * Setup process states
 */
export enum SetupState {
  IDLE = 'idle',
  CHECKING_EXISTING = 'checking_existing',
  DETECTING_BROWSERS = 'detecting_browsers',
  SELECTING_BROWSER = 'selecting_browser',
  INSTALLING_NATIVE_HOST = 'installing_native_host',
  CONFIGURING_MANIFEST = 'configuring_manifest',
  OPENING_EXTENSION_STORE = 'opening_extension_store',
  WAITING_FOR_EXTENSION = 'waiting_for_extension',
  VERIFYING_CONNECTION = 'verifying_connection',
  COMPLETE = 'complete',
  ERROR = 'error',
  CANCELLED = 'cancelled'
}

/**
 * Installation status check result
 */
export interface InstallationStatus {
  isComplete: boolean;
  hasNativeHost: boolean;
  hasBrowserExtension: boolean;
  isConnected: boolean;
  installedBrowsers: BrowserInfo[];
  errors: string[];
}

/**
 * Setup process result
 */
export interface SetupResult {
  success: boolean;
  state: SetupState;
  browser?: BrowserInfo;
  error?: Error;
  installationPath?: string;
  manifestPath?: string;
}

/**
 * Native host manifest structure
 */
export interface NativeHostManifest {
  name: string;
  description: string;
  path: string;
  args?: string[];
  type: 'stdio';
  allowed_origins?: string[];
  allowed_extensions?: string[];
}

/**
 * Platform-specific paths
 */
export interface PlatformPaths {
  nativeHostDir: string;
  chromeManifestDir?: string;
  firefoxManifestDir?: string;
  edgeManifestDir?: string;
}

/**
 * Extension store URLs
 */
export const EXTENSION_STORES = {
  [BrowserType.CHROME]: 'https://chrome.google.com/webstore/detail/pkm-assistant/YOUR_EXTENSION_ID',
  [BrowserType.FIREFOX]: 'https://addons.mozilla.org/firefox/addon/pkm-assistant/',
  [BrowserType.EDGE]: 'https://microsoftedge.microsoft.com/addons/detail/pkm-assistant/YOUR_EXTENSION_ID',
  [BrowserType.BRAVE]: 'https://chrome.google.com/webstore/detail/pkm-assistant/YOUR_EXTENSION_ID',
  [BrowserType.OPERA]: 'https://addons.opera.com/extensions/details/pkm-assistant/'
};

/**
 * Known extension IDs from store publishing
 */
export const EXTENSION_IDS = {
  [BrowserType.CHROME]: 'YOUR_CHROME_EXTENSION_ID',
  [BrowserType.FIREFOX]: 'pkm-assistant@example.com',
  [BrowserType.EDGE]: 'YOUR_EDGE_EXTENSION_ID',
  [BrowserType.BRAVE]: 'YOUR_CHROME_EXTENSION_ID', // Same as Chrome
  [BrowserType.OPERA]: 'YOUR_OPERA_EXTENSION_ID'
};