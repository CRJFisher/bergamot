import { describe, it, expect, jest } from "@jest/globals";
import {
  uint8_array_to_base64,
  compress_content,
  extract_page_content,
  create_visit_data,
  create_zstd_instance
} from "../src/core/data_collector";
import { VisitData } from "../src/types/navigation";

// Mock the zstd module
jest.mock("@hpcc-js/wasm-zstd", () => {
  const { jest } = require('@jest/globals');
  return {
    Zstd: {
      load: jest.fn(() => Promise.resolve({
        compress: jest.fn((data: Uint8Array) => {
          // Simple mock compression - just return first 10 bytes
          return data.slice(0, 10);
        })
      }))
    }
  };
});

describe("data_collector", () => {
  describe("uint8_array_to_base64", () => {
    it("should convert Uint8Array to base64", () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = uint8_array_to_base64(data);
      
      expect(result).toBe("SGVsbG8=");
    });

    it("should handle empty array", () => {
      const data = new Uint8Array([]);
      const result = uint8_array_to_base64(data);
      
      expect(result).toBe("");
    });

    it("should handle binary data", () => {
      const data = new Uint8Array([0, 255, 128, 64]);
      const result = uint8_array_to_base64(data);
      
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  describe("compress_content", () => {
    it("should compress string content", async () => {
      const mock_zstd = {
        compress: jest.fn((data: Uint8Array) => new Uint8Array([1, 2, 3, 4, 5]))
      };
      
      const result = await compress_content("Hello World", mock_zstd);
      
      expect(mock_zstd.compress).toHaveBeenCalled();
      expect(result).toBe("AQIDBAU="); // base64 of [1,2,3,4,5]
    });

    it("should handle compression error", async () => {
      const mock_zstd = {
        compress: jest.fn(() => { throw new Error("Compression failed"); })
      };
      
      const result = await compress_content("Hello World", mock_zstd);
      
      expect(result).toBe("Error compressing content.");
    });

    it("should log compression ratio", async () => {
      const console_spy = jest.spyOn(console, 'log');
      const mock_zstd = {
        compress: jest.fn((data: Uint8Array) => new Uint8Array(5))
      };
      
      await compress_content("Hello World", mock_zstd);
      
      expect(console_spy).toHaveBeenCalledWith(
        expect.stringContaining("Content compressed from 11 to 5 bytes")
      );
      
      console_spy.mockRestore();
    });
  });

  describe("extract_page_content", () => {
    it("should extract body HTML", () => {
      // Mock document.body
      const original_body = document.body;
      const mock_body = {
        outerHTML: '<body><div>Test Content</div></body>'
      };
      
      Object.defineProperty(document, 'body', {
        value: mock_body,
        writable: true,
        configurable: true
      });
      
      const result = extract_page_content();
      
      expect(result).toBe('<body><div>Test Content</div></body>');
      
      // Restore
      Object.defineProperty(document, 'body', {
        value: original_body,
        writable: true,
        configurable: true
      });
    });
  });

  describe("create_visit_data", () => {
    it("should create VisitData with all fields", async () => {
      const mock_zstd = {
        compress: jest.fn((data: Uint8Array) => new Uint8Array([1, 2, 3]))
      };
      
      // Mock document.body
      const original_body = document.body;
      Object.defineProperty(document, 'body', {
        value: { outerHTML: '<body>Test</body>' },
        writable: true,
        configurable: true
      });
      
      const visit_data = await create_visit_data(
        "https://example.com",
        "https://referrer.com",
        1234567890,
        mock_zstd
      );
      
      expect(visit_data).toBeInstanceOf(VisitData);
      expect(visit_data.url).toBe("https://example.com");
      expect(visit_data.referrer).toBe("https://referrer.com");
      expect(visit_data.referrer_timestamp).toBe(1234567890);
      expect(visit_data.content).toBe("AQID"); // base64 of [1,2,3]
      expect(visit_data.page_loaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date
      
      // Restore
      Object.defineProperty(document, 'body', {
        value: original_body,
        writable: true,
        configurable: true
      });
    });

    it("should handle undefined referrer timestamp", async () => {
      const mock_zstd = {
        compress: jest.fn((data: Uint8Array) => new Uint8Array([]))
      };
      
      const visit_data = await create_visit_data(
        "https://example.com",
        "",
        undefined,
        mock_zstd
      );
      
      expect(visit_data.referrer_timestamp).toBeUndefined();
    });
  });

  describe("create_zstd_instance", () => {
    it("should create zstd instance", async () => {
      const instance = await create_zstd_instance();
      
      expect(instance).toBeDefined();
      expect(instance.compress).toBeDefined();
    });
  });
});