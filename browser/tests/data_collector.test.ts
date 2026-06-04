import { describe, it, expect, jest } from "@jest/globals";
import {
  uint8_array_to_base64,
  compress_content,
  extract_page_content,
  create_visit_data,
  create_zstd_instance
} from "../src/core/data_collector";
import { VisitData } from "../src/types/navigation";

// Mock the zstd module. Plain functions (not jest.fn) so the factory references
// no out-of-scope variables — these mocks are never asserted on directly.
jest.mock("@hpcc-js/wasm-zstd", () => ({
  Zstd: {
    // Simple mock compression — just return the first 10 bytes.
    load: () => Promise.resolve({
      compress: (data: Uint8Array) => data.slice(0, 10)
    })
  }
}));

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
        compress: jest.fn(() => new Uint8Array([1, 2, 3, 4, 5]))
      };

      const result = await compress_content("Hello World", mock_zstd);

      expect(mock_zstd.compress).toHaveBeenCalled();
      expect(result).toBe("AQIDBAU="); // base64 of [1,2,3,4,5]
    });

    it("should throw on compression error", async () => {
      const mock_zstd = {
        compress: jest.fn(() => { throw new Error("Compression failed"); })
      };

      await expect(compress_content("Hello World", mock_zstd)).rejects.toThrow(
        "Compression failed"
      );
    });

    it("should log compression ratio", async () => {
      const console_spy = jest.spyOn(console, 'log');
      const mock_zstd = {
        compress: jest.fn(() => new Uint8Array(5))
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
    it("should create VisitData with raw page content and all fields", () => {
      // Mock document.body
      const original_body = document.body;
      Object.defineProperty(document, 'body', {
        value: { outerHTML: '<body>Test</body>' },
        writable: true,
        configurable: true
      });

      const visit_data = create_visit_data(
        "https://example.com",
        "https://referrer.com",
        1234567890
      );

      expect(visit_data).toBeInstanceOf(VisitData);
      expect(visit_data.url).toBe("https://example.com");
      expect(visit_data.referrer).toBe("https://referrer.com");
      expect(visit_data.referrer_timestamp).toBe(1234567890);
      // Content is the raw markup; the background service worker compresses it.
      expect(visit_data.content).toBe("<body>Test</body>");
      expect(visit_data.page_loaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date

      // Restore
      Object.defineProperty(document, 'body', {
        value: original_body,
        writable: true,
        configurable: true
      });
    });

    it("should handle undefined referrer timestamp", () => {
      const visit_data = create_visit_data(
        "https://example.com",
        "",
        undefined
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