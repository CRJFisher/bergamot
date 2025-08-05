import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { 
  create_tab_history_store,
  add_tab_history,
  remove_tab_history,
  get_tab_history,
  update_tab_history,
  create_tab_history,
  get_referrer_from_history
} from "../src/core/tab_history_manager";
import { TabHistory } from "../src/types/navigation";

describe("Background Script - Functional Tab History", () => {
  let mock_tabs: { [key: number]: chrome.tabs.Tab };

  beforeEach(() => {
    // Reset mocks
    mock_tabs = {};

    // Mock chrome.tabs API
    global.chrome = {
      tabs: {
        get: jest.fn((tab_id: number) => Promise.resolve(mock_tabs[tab_id])),
        query: jest.fn(() => Promise.resolve(Object.values(mock_tabs))),
        onCreated: {
          addListener: jest.fn(),
        },
        onUpdated: {
          addListener: jest.fn(),
        },
        onRemoved: {
          addListener: jest.fn(),
        },
      },
      runtime: {
        onMessage: {
          addListener: jest.fn(),
        },
        onInstalled: {
          addListener: jest.fn(),
        },
      },
    } as any;
  });

  describe("Tab History Management", () => {
    it("should track referrer when opening URL in new tab", () => {
      // Setup initial state
      const source_tab_id = 1;
      const target_tab_id = 2;
      const source_url = "https://example.com/source";
      const target_url = "https://example.com/target";
      const second_url = "https://example.com/second";

      // Create initial store
      let store = create_tab_history_store();

      // Add source tab history
      const source_history = create_tab_history(source_url);
      store = add_tab_history(store, source_tab_id, source_history);

      // Create target tab with opener
      const target_history = new TabHistory(
        source_url, // Previous URL from opener
        target_url,
        Date.now(),
        source_history.timestamp,
        source_tab_id
      );
      store = add_tab_history(store, target_tab_id, target_history);

      // Update target tab navigation
      const updated_history = update_tab_history(
        get_tab_history(store, target_tab_id),
        second_url
      );
      store = add_tab_history(store, target_tab_id, updated_history);

      // Verify final state
      const final_history = get_tab_history(store, target_tab_id);
      expect(final_history?.previous_url).toBe(target_url);
      expect(final_history?.current_url).toBe(second_url);
      expect(final_history?.opener_tab_id).toBe(source_tab_id);
    });

    it("should handle referrer through about:blank navigation", () => {
      // Setup initial state
      const source_tab_id = 59;
      const target_tab_id = 73;
      const source_url = "https://safebrowsing.google.com/";
      const target_url = "https://support.google.com/websearch/answer/45449";

      // Create initial store
      let store = create_tab_history_store();

      // Add source tab history
      const source_history = create_tab_history(source_url);
      store = add_tab_history(store, source_tab_id, source_history);

      // Create target tab with about:blank
      const initial_target_history = new TabHistory(
        source_url, // Referrer from opener
        "about:blank",
        Date.now(),
        source_history.timestamp,
        source_tab_id
      );
      store = add_tab_history(store, target_tab_id, initial_target_history);

      // Navigate to actual URL
      const updated_history = update_tab_history(
        get_tab_history(store, target_tab_id),
        target_url
      );
      store = add_tab_history(store, target_tab_id, updated_history);

      // Verify state
      const final_history = get_tab_history(store, target_tab_id);
      expect(final_history?.previous_url).toBe("about:blank");
      expect(final_history?.current_url).toBe(target_url);
      expect(final_history?.opener_tab_id).toBe(source_tab_id);

      // Test get_referrer logic
      const referrer_info = get_referrer_from_history(
        final_history,
        get_tab_history(store, source_tab_id)
      );
      expect(referrer_info.referrer).toBe(source_url);
    });

    it("should clean up tab history on removal", () => {
      // Setup initial state
      const tab_id = 1;
      let store = create_tab_history_store();

      // Add tab history
      const history = create_tab_history("https://example.com");
      store = add_tab_history(store, tab_id, history);
      expect(get_tab_history(store, tab_id)).toBeDefined();

      // Remove tab
      store = remove_tab_history(store, tab_id);
      expect(get_tab_history(store, tab_id)).toBeUndefined();
    });

    it("should maintain immutability of store", () => {
      const store1 = create_tab_history_store();
      const history = create_tab_history("https://example.com");
      const store2 = add_tab_history(store1, 1, history);

      // Original store should be unchanged
      expect(store1.size).toBe(0);
      expect(store2.size).toBe(1);
      expect(store1).not.toBe(store2);
    });
  });
});