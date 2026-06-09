import { describe, it, expect } from "@jest/globals";
import {
  generate_visit_id,
  create_visit_data
} from "../src/core/data_collector";
import { VisitData } from "../src/types/navigation";

describe("data_collector", () => {
  describe("generate_visit_id", () => {
    it("produces a UUID-shaped correlation id", () => {
      const id = generate_visit_id();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("produces a distinct id each call", () => {
      expect(generate_visit_id()).not.toBe(generate_visit_id());
    });
  });

  describe("create_visit_data", () => {
    it("builds a metadata-only VisitData with the tab title and no content", () => {
      const visit_data = create_visit_data(
        "https://example.com",
        "Example Page",
        "https://referrer.com",
        1234567890
      );

      expect(visit_data).toBeInstanceOf(VisitData);
      expect(visit_data.url).toBe("https://example.com");
      expect(visit_data.title).toBe("Example Page");
      expect(visit_data.referrer).toBe("https://referrer.com");
      expect(visit_data.referrer_timestamp).toBe(1234567890);
      expect(visit_data.page_loaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date
      // The payload carries no page content of any kind.
      expect("content" in visit_data).toBe(false);
    });

    it("handles an undefined referrer timestamp", () => {
      const visit_data = create_visit_data(
        "https://example.com",
        "",
        "",
        undefined
      );

      expect(visit_data.referrer_timestamp).toBeUndefined();
    });
  });
});
