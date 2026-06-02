import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  handle_get_referrer,
  handle_server_request,
  handle_message
} from "../src/core/message_router";
import { 
  create_tab_history_store, 
  add_tab_history, 
  create_tab_history 
} from "../src/core/tab_history_manager";
import { TabHistory } from "../src/types/navigation";

// Mock the api_client module
jest.mock("../src/core/api_client", () => ({
  send_to_server: jest.fn()
}));

import { send_to_server } from "../src/core/api_client";

describe("message_router", () => {
  describe("handle_get_referrer", () => {
    it("should return referrer from tab history", () => {
      let store = create_tab_history_store();
      const history = new TabHistory(
        "https://referrer.com",
        "https://current.com",
        Date.now(),
        Date.now() - 1000
      );
      store = add_tab_history(store, 123, history);
      
      const response = handle_get_referrer(123, store);
      
      expect(response.success).toBe(true);
      expect(response.referrer).toBe("https://referrer.com");
      expect(response.referrer_timestamp).toBe(history.previous_url_timestamp);
    });

    it("should handle tab with opener", () => {
      let store = create_tab_history_store();
      
      // Opener tab
      const opener_history = create_tab_history("https://opener.com");
      store = add_tab_history(store, 100, opener_history);
      
      // Current tab with about:blank
      const current_history = new TabHistory(
        "about:blank",
        "https://current.com",
        Date.now(),
        Date.now() - 1000,
        100 // opener_tab_id
      );
      store = add_tab_history(store, 200, current_history);
      
      const response = handle_get_referrer(200, store);
      
      expect(response.referrer).toBe("https://opener.com");
    });

    it("should return empty referrer for unknown tab", () => {
      const store = create_tab_history_store();
      const response = handle_get_referrer(999, store);
      
      expect(response.success).toBe(true);
      expect(response.referrer).toBe("");
      expect(response.referrer_timestamp).toBeLessThanOrEqual(Date.now());
    });
  });


  describe("handle_server_request", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should forward request to server", async () => {
      (send_to_server as jest.MockedFunction<typeof send_to_server>).mockResolvedValue(undefined);
      
      const response = await handle_server_request(
        "/visit",
        { url: "https://example.com" },
        "http://localhost:5000"
      );
      
      expect(send_to_server).toHaveBeenCalledWith(
        "http://localhost:5000",
        "/visit",
        { url: "https://example.com" }
      );
      expect(response.success).toBe(true);
    });

    it("should handle server error", async () => {
      (send_to_server as jest.MockedFunction<typeof send_to_server>).mockRejectedValue(new Error("Network error"));
      
      const response = await handle_server_request(
        "/visit",
        { url: "https://example.com" },
        "http://localhost:5000"
      );
      
      expect(response.success).toBe(false);
      expect(response.error).toBe("Network error");
    });
  });

  describe("handle_message", () => {
    let store = create_tab_history_store();

    beforeEach(() => {
      jest.clearAllMocks();
      store = create_tab_history_store();
    });

    it("should handle getReferrer message", async () => {
      const history = create_tab_history("https://example.com");
      store = add_tab_history(store, 123, history);
      
      const result = await handle_message(
        { action: "getReferrer" },
        123,
        store
      );
      
      expect(result.response.success).toBe(true);
      expect(result.response.referrer).toBe("");
    });

    it("should handle getReferrer without tab ID", async () => {
      const result = await handle_message(
        { action: "getReferrer" },
        undefined,
        store
      );
      
      expect(result.response.error).toBe("No tab ID");
    });

    it("should handle sendToPKMServer message", async () => {
      (send_to_server as jest.MockedFunction<typeof send_to_server>).mockResolvedValue(undefined);
      
      const result = await handle_message(
        {
          action: "sendToPKMServer",
          endpoint: "/visit",
          data: { url: "https://test.com" },
          api_base_url: "http://localhost:5000"
        },
        123,
        store
      );
      
      expect(send_to_server).toHaveBeenCalled();
      expect(result.response.success).toBe(true);
    });

    it("should handle sendToPKMServer without required data", async () => {
      const result = await handle_message(
        { action: "sendToPKMServer" },
        123,
        store
      );
      
      expect(result.response.error).toBe("Missing endpoint, data, or API base URL");
    });

    it("should handle unknown action", async () => {
      const result = await handle_message(
        { action: "unknownAction" as any },
        123,
        store
      );
      
      expect(result.response.error).toBe("Unknown action");
    });
  });
});