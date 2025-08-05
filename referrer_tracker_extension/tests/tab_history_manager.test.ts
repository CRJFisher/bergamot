import { describe, it, expect } from "@jest/globals";
import {
  create_tab_history,
  update_tab_history,
  get_referrer_from_history,
  create_tab_history_store,
  add_tab_history,
  remove_tab_history,
  get_tab_history
} from "../src/core/tab_history_manager";
import { TabHistory } from "../src/types/navigation";

describe("tab_history_manager", () => {
  describe("create_tab_history", () => {
    it("should create a new tab history with current URL", () => {
      const history = create_tab_history("https://example.com");
      
      expect(history.current_url).toBe("https://example.com");
      expect(history.previous_url).toBeUndefined();
      expect(history.timestamp).toBeLessThanOrEqual(Date.now());
      expect(history.opener_tab_id).toBeUndefined();
    });

    it("should create history with opener tab ID", () => {
      const history = create_tab_history("https://example.com", 42);
      
      expect(history.current_url).toBe("https://example.com");
      expect(history.opener_tab_id).toBe(42);
    });

    it("should inherit from previous history", () => {
      const previous = new TabHistory(
        "https://old.com",
        "https://previous.com",
        Date.now() - 1000,
        Date.now() - 2000,
        10
      );
      
      const history = create_tab_history("https://new.com", 20, previous);
      
      expect(history.current_url).toBe("https://new.com");
      expect(history.previous_url).toBe("https://previous.com");
      expect(history.opener_tab_id).toBe(20); // New opener takes precedence
    });
  });

  describe("update_tab_history", () => {
    it("should update history with new URL", () => {
      const current = new TabHistory(
        undefined,
        "https://current.com",
        Date.now() - 1000
      );
      
      const updated = update_tab_history(current, "https://new.com");
      
      expect(updated.current_url).toBe("https://new.com");
      expect(updated.previous_url).toBe("https://current.com");
      expect(updated.previous_url_timestamp).toBe(current.timestamp);
    });

    it("should not update previous URL if navigating to same URL", () => {
      const current = new TabHistory(
        "https://previous.com",
        "https://current.com",
        Date.now() - 1000,
        Date.now() - 2000
      );
      
      const updated = update_tab_history(current, "https://current.com");
      
      expect(updated.current_url).toBe("https://current.com");
      expect(updated.previous_url).toBe("https://previous.com");
      expect(updated.previous_url_timestamp).toBe(current.previous_url_timestamp);
    });

    it("should handle undefined current history", () => {
      const updated = update_tab_history(undefined, "https://new.com");
      
      expect(updated.current_url).toBe("https://new.com");
      expect(updated.previous_url).toBeUndefined();
    });

    it("should preserve opener tab ID", () => {
      const current = new TabHistory(
        undefined,
        "https://current.com",
        Date.now(),
        undefined,
        123
      );
      
      const updated = update_tab_history(current, "https://new.com");
      expect(updated.opener_tab_id).toBe(123);
    });
  });

  describe("get_referrer_from_history", () => {
    it("should return referrer from previous URL", () => {
      const history = new TabHistory(
        "https://referrer.com",
        "https://current.com",
        Date.now(),
        Date.now() - 1000
      );
      
      const referrer_info = get_referrer_from_history(history, undefined);
      
      expect(referrer_info.referrer).toBe("https://referrer.com");
      expect(referrer_info.referrer_timestamp).toBe(history.previous_url_timestamp);
    });

    it("should use opener URL when previous is about:blank", () => {
      const history = new TabHistory(
        "about:blank",
        "https://current.com",
        Date.now(),
        Date.now() - 1000,
        42
      );
      
      const opener_history = new TabHistory(
        undefined,
        "https://opener.com",
        Date.now() - 2000
      );
      
      const referrer_info = get_referrer_from_history(history, opener_history);
      
      expect(referrer_info.referrer).toBe("https://opener.com");
      expect(referrer_info.referrer_timestamp).toBe(opener_history.timestamp);
    });

    it("should return empty referrer when no history", () => {
      const referrer_info = get_referrer_from_history(undefined, undefined);
      
      expect(referrer_info.referrer).toBe("");
      expect(referrer_info.referrer_timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("should handle empty string previous URL with opener", () => {
      const history = new TabHistory(
        "",
        "https://current.com",
        Date.now(),
        undefined,
        42
      );
      
      const opener_history = new TabHistory(
        undefined,
        "https://opener.com",
        Date.now() - 1000
      );
      
      const referrer_info = get_referrer_from_history(history, opener_history);
      
      expect(referrer_info.referrer).toBe("https://opener.com");
    });
  });

  describe("TabHistoryStore operations", () => {
    it("should create empty store", () => {
      const store = create_tab_history_store();
      expect(store.size).toBe(0);
    });

    it("should add tab history to store", () => {
      const store = create_tab_history_store();
      const history = create_tab_history("https://example.com");
      
      const new_store = add_tab_history(store, 1, history);
      
      expect(new_store.size).toBe(1);
      expect(get_tab_history(new_store, 1)).toEqual(history);
      expect(store.size).toBe(0); // Original unchanged
    });

    it("should update existing tab history", () => {
      let store = create_tab_history_store();
      const history1 = create_tab_history("https://example1.com");
      const history2 = create_tab_history("https://example2.com");
      
      store = add_tab_history(store, 1, history1);
      store = add_tab_history(store, 1, history2);
      
      expect(store.size).toBe(1);
      expect(get_tab_history(store, 1)).toEqual(history2);
    });

    it("should remove tab history from store", () => {
      let store = create_tab_history_store();
      const history = create_tab_history("https://example.com");
      
      store = add_tab_history(store, 1, history);
      store = add_tab_history(store, 2, history);
      
      const new_store = remove_tab_history(store, 1);
      
      expect(new_store.size).toBe(1);
      expect(get_tab_history(new_store, 1)).toBeUndefined();
      expect(get_tab_history(new_store, 2)).toEqual(history);
    });

    it("should handle removing non-existent tab", () => {
      const store = create_tab_history_store();
      const new_store = remove_tab_history(store, 999);
      
      expect(new_store.size).toBe(0);
    });

    it("should get undefined for non-existent tab", () => {
      const store = create_tab_history_store();
      expect(get_tab_history(store, 999)).toBeUndefined();
    });
  });
});