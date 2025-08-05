import { PKMConfig } from '../types/navigation';

declare const MOCK_PKM_PORT: string | undefined;

// Pure functions for configuration management
export const load_configuration = (): PKMConfig => {
  // Check for test environment
  if (typeof MOCK_PKM_PORT !== "undefined") {
    return new PKMConfig(
      `http://localhost:${MOCK_PKM_PORT}`,
      true,
      'debug'
    );
  }

  // Check for window.PKM_CONFIG
  const window_config = (window as any).PKM_CONFIG;
  if (window_config?.apiBaseUrl) {
    return new PKMConfig(
      window_config.apiBaseUrl,
      window_config.debug || false,
      window_config.logLevel || 'info'
    );
  }

  // Default configuration
  return new PKMConfig(
    'http://localhost:5000',
    false,
    'info'
  );
};

export const get_api_base_url = (config: PKMConfig): string => config.api_base_url;

export const is_debug_mode = (config: PKMConfig): boolean => config.debug;

export const get_log_level = (config: PKMConfig): string => config.log_level;

export const update_config = (config: PKMConfig, updates: Partial<PKMConfig>): PKMConfig => {
  return new PKMConfig(
    updates.api_base_url || config.api_base_url,
    updates.debug !== undefined ? updates.debug : config.debug,
    updates.log_level || config.log_level
  );
};