import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  create_navigation_state,
  has_been_visited,
  mark_as_visited,
  should_handle_navigation,
  create_push_state_handler,
  create_replace_state_handler,
  create_popstate_handler
} from "../src/core/navigation_detector";

describe("navigation_detector", () => {
  describe("create_navigation_state", () => {
    it("should create initial state with normalized URL", () => {
      const state = create_navigation_state("https://example.com/page?utm_source=test#section");
      
      expect(state.current_path).toBe("https://example.com/page#section");
      expect(state.visited_urls.size).toBe(1);
      expect(state.visited_urls.has("https://example.com/page#section")).toBe(true);
      expect(state.last_known_url).toBe("https://example.com/page?utm_source=test#section");
    });
  });

  describe("has_been_visited", () => {
    it("should return true for visited URL", () => {
      const state = create_navigation_state("https://example.com/page");
      expect(has_been_visited(state, "https://example.com/page")).toBe(true);
    });

    it("should return true for URL with tracking params if base was visited", () => {
      const state = create_navigation_state("https://example.com/page");
      expect(has_been_visited(state, "https://example.com/page?utm_source=test")).toBe(true);
    });

    it("should return false for unvisited URL", () => {
      const state = create_navigation_state("https://example.com/page");
      expect(has_been_visited(state, "https://example.com/other")).toBe(false);
    });
  });

  describe("mark_as_visited", () => {
    it("should add URL to visited set", () => {
      let state = create_navigation_state("https://example.com/page");
      state = mark_as_visited(state, "https://example.com/other");
      
      expect(state.visited_urls.size).toBe(2);
      expect(has_been_visited(state, "https://example.com/other")).toBe(true);
    });

    it("should normalize URL before adding", () => {
      let state = create_navigation_state("https://example.com/page");
      state = mark_as_visited(state, "https://example.com/other?utm_source=test");
      
      expect(has_been_visited(state, "https://example.com/other")).toBe(true);
      expect(has_been_visited(state, "https://example.com/other?utm_campaign=test")).toBe(true);
    });

    it("should return new state object", () => {
      const state1 = create_navigation_state("https://example.com/page");
      const state2 = mark_as_visited(state1, "https://example.com/other");
      
      expect(state1).not.toBe(state2);
      expect(state1.visited_urls.size).toBe(1);
      expect(state2.visited_urls.size).toBe(2);
    });
  });

  describe("should_handle_navigation", () => {
    it("should handle navigation to new path", () => {
      const state = create_navigation_state("https://example.com/page1");
      const result = should_handle_navigation(state, "https://example.com/page2", "test");
      
      expect(result.should_handle).toBe(true);
      expect(result.new_state.current_path).toBe("https://example.com/page2");
      expect(result.new_state.last_known_url).toBe("https://example.com/page2");
      expect(has_been_visited(result.new_state, "https://example.com/page2")).toBe(true);
    });

    it("should not handle navigation to same path", () => {
      const state = create_navigation_state("https://example.com/page");
      const result = should_handle_navigation(state, "https://example.com/page", "test");
      
      expect(result.should_handle).toBe(false);
      expect(result.new_state.current_path).toBe("https://example.com/page");
    });

    it("should not handle navigation to visited URL", () => {
      let state = create_navigation_state("https://example.com/page1");
      state = mark_as_visited(state, "https://example.com/page2");
      
      const result = should_handle_navigation(state, "https://example.com/page2", "test");
      
      expect(result.should_handle).toBe(false);
      expect(result.new_state.current_path).toBe("https://example.com/page2");
    });

    it("should ignore tracking parameters when comparing paths", () => {
      const state = create_navigation_state("https://example.com/page");
      const result = should_handle_navigation(
        state, 
        "https://example.com/page?utm_source=test", 
        "test"
      );
      
      expect(result.should_handle).toBe(false);
    });
  });

  describe("history method handlers", () => {
    let mock_state: any;
    let get_state: jest.MockedFunction<() => any>;
    let update_state: jest.MockedFunction<(state: any) => void>;
    let callback: jest.MockedFunction<(url: string) => void>;
    let original_push_state: any;
    let original_replace_state: any;

    beforeEach(() => {
      mock_state = create_navigation_state("https://example.com/initial");
      get_state = jest.fn(() => mock_state);
      update_state = jest.fn((new_state) => { mock_state = new_state; });
      callback = jest.fn();
      
      original_push_state = history.pushState;
      original_replace_state = history.replaceState;
      
      history.pushState = jest.fn();
      history.replaceState = jest.fn();
    });

    afterEach(() => {
      history.pushState = original_push_state;
      history.replaceState = original_replace_state;
    });

    describe("create_push_state_handler", () => {
      it("should call callback for new navigation", () => {
        const handler = create_push_state_handler(get_state, update_state, callback);
        
        handler({}, "", "https://example.com/new");
        
        expect(history.pushState).toHaveBeenCalledWith({}, "", "https://example.com/new");
        expect(callback).toHaveBeenCalledWith("https://example.com/new");
        expect(update_state).toHaveBeenCalled();
      });

      it("should not call callback for same path", () => {
        const handler = create_push_state_handler(get_state, update_state, callback);
        
        handler({}, "", "https://example.com/initial");
        
        expect(history.pushState).toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();
      });

      it("should handle null URL", () => {
        // null URL means use current location
        const handler = create_push_state_handler(get_state, update_state, callback);
        
        handler({}, "", null);
        
        // In jsdom, the default URL is http://localhost/
        expect(callback).toHaveBeenCalledWith("http://localhost/");
      });
    });

    describe("create_replace_state_handler", () => {
      it("should call callback for new navigation", () => {
        const handler = create_replace_state_handler(get_state, update_state, callback);
        
        handler({}, "", "https://example.com/replaced");
        
        expect(history.replaceState).toHaveBeenCalledWith({}, "", "https://example.com/replaced");
        expect(callback).toHaveBeenCalledWith("https://example.com/replaced");
        expect(update_state).toHaveBeenCalled();
      });
    });

    describe("create_popstate_handler", () => {
      it("should call callback for navigation", () => {
        const handler = create_popstate_handler(get_state, update_state, callback);
        
        handler();
        
        // In jsdom, the default URL is http://localhost/
        expect(callback).toHaveBeenCalledWith("http://localhost/");
        expect(update_state).toHaveBeenCalled();
      });
    });
  });
});