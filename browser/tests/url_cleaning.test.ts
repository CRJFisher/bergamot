import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { normalize_url_for_navigation, tracking_parameters } from "../src/utils/url_cleaning";

describe("url_cleaning", () => {
  describe("tracking_parameters", () => {
    it("should contain common tracking parameters", () => {
      expect(tracking_parameters.has("utm_source")).toBe(true);
      expect(tracking_parameters.has("utm_medium")).toBe(true);
      expect(tracking_parameters.has("utm_campaign")).toBe(true);
      expect(tracking_parameters.has("fbclid")).toBe(true);
      expect(tracking_parameters.has("gclid")).toBe(true);
    });

    it("should not contain non-tracking parameters", () => {
      expect(tracking_parameters.has("page")).toBe(false);
      expect(tracking_parameters.has("query")).toBe(false);
      expect(tracking_parameters.has("id")).toBe(false);
    });
  });

  describe("normalize_url_for_navigation", () => {
    // Suppress console logs for these tests
    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should remove all tracking parameters", () => {
      const result = normalize_url_for_navigation("https://example.com?utm_source=test&fbclid=123&page=1");
      expect(result).toBe("https://example.com/?page=1");
    });

    it("should preserve hash", () => {
      const result = normalize_url_for_navigation("https://example.com/page?utm_source=test#section");
      expect(result).toBe("https://example.com/page#section");
    });

    it("should handle URL with no parameters", () => {
      const result = normalize_url_for_navigation("https://example.com/page");
      expect(result).toBe("https://example.com/page");
    });

    it("should handle invalid URL gracefully", () => {
      const result = normalize_url_for_navigation("not-a-url");
      expect(result).toBe("not-a-url");
    });
  });
});