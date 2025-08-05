import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { send_to_server } from "../src/core/api_client";

// Mock fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe("api_client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset console mocks
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("send_to_server", () => {
    it("should send POST request with correct parameters", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200
      } as Response);

      await send_to_server(
        "http://localhost:5000",
        "/visit",
        { url: "https://example.com", timestamp: 123 }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:5000/visit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: "https://example.com", timestamp: 123 })
        }
      );
    });

    it("should log successful requests", async () => {
      const console_spy = jest.spyOn(console, 'log');
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200
      } as Response);

      await send_to_server("http://localhost:5000", "/visit", {});

      expect(console_spy).toHaveBeenCalledWith("🚀 Making request to: http://localhost:5000/visit");
      expect(console_spy).toHaveBeenCalledWith("✅ Successfully sent to /visit");
    });

    it("should throw error on failed request", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500
      } as Response);

      await expect(
        send_to_server("http://localhost:5000", "/error", {})
      ).rejects.toThrow("Failed to send to /error: 500");
    });

    it("should throw error on network failure", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error("Network error"));

      await expect(
        send_to_server("http://localhost:5000", "/visit", {})
      ).rejects.toThrow("Network error");
    });

    it("should handle different status codes", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 404
      } as Response);

      await expect(
        send_to_server("http://localhost:5000", "/notfound", {})
      ).rejects.toThrow("Failed to send to /notfound: 404");
    });

    it("should stringify complex data", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200
      } as Response);

      const complex_data = {
        url: "https://example.com",
        nested: {
          array: [1, 2, 3],
          object: { key: "value" }
        },
        timestamp: Date.now()
      };

      await send_to_server("http://localhost:5000", "/complex", complex_data);

      const call_args = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect((call_args[1] as RequestInit).body).toBe(JSON.stringify(complex_data));
    });

    it("should handle empty data", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200
      } as Response);

      await send_to_server("http://localhost:5000", "/empty", {});

      const call_args = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect((call_args[1] as RequestInit).body).toBe("{}");
    });

    it("should handle null data", async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200
      } as Response);

      await send_to_server("http://localhost:5000", "/null", null);

      const call_args = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect((call_args[1] as RequestInit).body).toBe("null");
    });
  });
});