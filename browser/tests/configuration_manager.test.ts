import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  load_configuration,
  get_api_base_url,
  is_debug_mode,
  get_log_level,
  update_config
} from "../src/core/configuration_manager";
import { PKMConfig } from "../src/types/navigation";

// Declare the mock port
declare const MOCK_PKM_PORT: string | undefined;

describe("configuration_manager", () => {
  let original_window_config: any;

  beforeEach(() => {
    // Save original window.PKM_CONFIG
    original_window_config = (window as any).PKM_CONFIG;
    delete (window as any).PKM_CONFIG;
    
    // Clear MOCK_PKM_PORT
    (global as any).MOCK_PKM_PORT = undefined;
  });

  afterEach(() => {
    // Restore original
    if (original_window_config !== undefined) {
      (window as any).PKM_CONFIG = original_window_config;
    } else {
      delete (window as any).PKM_CONFIG;
    }
    delete (global as any).MOCK_PKM_PORT;
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
      (global as any).MOCK_PKM_PORT = "9999";
      
      const config = load_configuration();
      
      expect(config.api_base_url).toBe("http://localhost:9999");
      expect(config.debug).toBe(true);
      expect(config.log_level).toBe("debug");
    });

    it("should load configuration from window.PKM_CONFIG", () => {
      (window as any).PKM_CONFIG = {
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
      (window as any).PKM_CONFIG = {
        apiBaseUrl: "https://partial.example.com"
      };
      
      const config = load_configuration();
      
      expect(config.api_base_url).toBe("https://partial.example.com");
      expect(config.debug).toBe(false);
      expect(config.log_level).toBe("info");
    });

    it("should prioritize MOCK_PKM_PORT over window config", () => {
      (global as any).MOCK_PKM_PORT = "8888";
      (window as any).PKM_CONFIG = {
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

  describe("update_config", () => {
    it("should update API base URL", () => {
      const config = new PKMConfig("http://old.com", false, "info");
      const updated = update_config(config, { api_base_url: "http://new.com" });
      
      expect(updated.api_base_url).toBe("http://new.com");
      expect(updated.debug).toBe(false);
      expect(updated.log_level).toBe("info");
    });

    it("should update debug mode", () => {
      const config = new PKMConfig("http://localhost", false, "info");
      const updated = update_config(config, { debug: true });
      
      expect(updated.api_base_url).toBe("http://localhost");
      expect(updated.debug).toBe(true);
      expect(updated.log_level).toBe("info");
    });

    it("should update log level", () => {
      const config = new PKMConfig("http://localhost", false, "info");
      const updated = update_config(config, { log_level: "error" });
      
      expect(updated.api_base_url).toBe("http://localhost");
      expect(updated.debug).toBe(false);
      expect(updated.log_level).toBe("error");
    });

    it("should update multiple fields", () => {
      const config = new PKMConfig("http://old.com", false, "info");
      const updated = update_config(config, {
        api_base_url: "http://new.com",
        debug: true,
        log_level: "debug"
      });
      
      expect(updated.api_base_url).toBe("http://new.com");
      expect(updated.debug).toBe(true);
      expect(updated.log_level).toBe("debug");
    });

    it("should handle empty updates", () => {
      const config = new PKMConfig("http://localhost", true, "debug");
      const updated = update_config(config, {});
      
      expect(updated.api_base_url).toBe("http://localhost");
      expect(updated.debug).toBe(true);
      expect(updated.log_level).toBe("debug");
    });

    it("should create new instance", () => {
      const config = new PKMConfig("http://localhost", false, "info");
      const updated = update_config(config, { debug: true });
      
      expect(config).not.toBe(updated);
      expect(config.debug).toBe(false);
      expect(updated.debug).toBe(true);
    });
  });
});