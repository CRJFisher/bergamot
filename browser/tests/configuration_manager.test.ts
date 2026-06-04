import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  load_configuration,
  get_api_base_url,
  is_debug_mode,
  get_log_level
} from "../src/core/configuration_manager";
import { PKMConfig } from "../src/types/navigation";

type PkmConfigShape = { apiBaseUrl?: string; debug?: boolean; logLevel?: string };
const test_window = window as Window & { PKM_CONFIG?: PkmConfigShape };
const test_global = global as typeof globalThis & { MOCK_PKM_PORT?: string };

describe("configuration_manager", () => {
  let original_window_config: PkmConfigShape | undefined;

  beforeEach(() => {
    // Save original window.PKM_CONFIG
    original_window_config = test_window.PKM_CONFIG;
    delete test_window.PKM_CONFIG;

    // Clear MOCK_PKM_PORT
    test_global.MOCK_PKM_PORT = undefined;
  });

  afterEach(() => {
    // Restore original
    if (original_window_config !== undefined) {
      test_window.PKM_CONFIG = original_window_config;
    } else {
      delete test_window.PKM_CONFIG;
    }
    delete test_global.MOCK_PKM_PORT;
  });

  describe("load_configuration", () => {
    it("should load default configuration", () => {
      const config = load_configuration();
      
      expect(config).toBeInstanceOf(PKMConfig);
      expect(config.api_base_url).toBe("http://localhost:5000");
      expect(config.debug).toBe(false);
      expect(config.log_level).toBe("info");
    });

    it("should load test configuration when MOCK_PKM_PORT is set", () => {
      test_global.MOCK_PKM_PORT = "9999";
      
      const config = load_configuration();
      
      expect(config.api_base_url).toBe("http://localhost:9999");
      expect(config.debug).toBe(true);
      expect(config.log_level).toBe("debug");
    });

    it("should load configuration from window.PKM_CONFIG", () => {
      test_window.PKM_CONFIG = {
        apiBaseUrl: "https://custom.example.com",
        debug: true,
        logLevel: "warn"
      };
      
      const config = load_configuration();
      
      expect(config.api_base_url).toBe("https://custom.example.com");
      expect(config.debug).toBe(true);
      expect(config.log_level).toBe("warn");
    });

    it("should handle partial window config", () => {
      test_window.PKM_CONFIG = {
        apiBaseUrl: "https://partial.example.com"
      };
      
      const config = load_configuration();
      
      expect(config.api_base_url).toBe("https://partial.example.com");
      expect(config.debug).toBe(false);
      expect(config.log_level).toBe("info");
    });

    it("should prioritize MOCK_PKM_PORT over window config", () => {
      test_global.MOCK_PKM_PORT = "8888";
      test_window.PKM_CONFIG = {
        apiBaseUrl: "https://should-be-ignored.com"
      };
      
      const config = load_configuration();
      
      expect(config.api_base_url).toBe("http://localhost:8888");
    });
  });

  describe("configuration accessors", () => {
    it("should get API base URL", () => {
      const config = new PKMConfig("https://api.example.com", false, "info");
      expect(get_api_base_url(config)).toBe("https://api.example.com");
    });

    it("should get debug mode", () => {
      const config1 = new PKMConfig("http://localhost", true, "debug");
      const config2 = new PKMConfig("http://localhost", false, "info");
      
      expect(is_debug_mode(config1)).toBe(true);
      expect(is_debug_mode(config2)).toBe(false);
    });

    it("should get log level", () => {
      const config1 = new PKMConfig("http://localhost", false, "error");
      const config2 = new PKMConfig("http://localhost", false, "debug");
      
      expect(get_log_level(config1)).toBe("error");
      expect(get_log_level(config2)).toBe("debug");
    });
  });

});