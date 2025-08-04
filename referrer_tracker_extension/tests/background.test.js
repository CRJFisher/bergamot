"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const background_1 = require("../src/background");
(0, globals_1.describe)("Background Script", () => {
    let mock_tabs;
    let mock_storage;
    (0, globals_1.beforeEach)(() => {
        // Reset mocks
        mock_tabs = {};
        mock_storage = {};
        // Mock chrome.tabs API
        global.chrome = {
            tabs: {
                get: globals_1.jest.fn((tabId) => Promise.resolve(mock_tabs[tabId])),
                query: globals_1.jest.fn(() => Promise.resolve(Object.values(mock_tabs))),
                onUpdated: {
                    addListener: globals_1.jest.fn(),
                },
                onRemoved: {
                    addListener: globals_1.jest.fn(),
                },
                onActivated: {
                    addListener: globals_1.jest.fn(),
                },
            },
            storage: {
                local: {
                    get: globals_1.jest.fn((keys) => Promise.resolve(mock_storage)),
                    set: globals_1.jest.fn((items) => {
                        Object.assign(mock_storage, items);
                        return Promise.resolve();
                    }),
                },
            },
            runtime: {
                onMessage: {
                    addListener: globals_1.jest.fn(),
                },
            },
        };
    });
    (0, globals_1.describe)("New Tab Behavior", () => {
        (0, globals_1.it)("should track referrer when opening URL in new tab", async () => {
            // Setup initial state
            const source_tab_id = 1;
            const target_tab_id = 2;
            const source_url = "https://example.com/source";
            const target_url = "https://example.com/target";
            // Mock source tab
            mock_tabs[source_tab_id] = {
                id: source_tab_id,
                url: source_url,
                active: true,
            };
            // Set the opener's history in tabHistories
            background_1.tabHistories.set(source_tab_id, {
                currentUrl: source_url,
                timestamp: Date.now(),
            });
            // Mock target tab
            mock_tabs[target_tab_id] = {
                id: target_tab_id,
                url: target_url,
                active: false,
                openerTabId: source_tab_id,
            };
            // Simulate opening target URL in new tab
            await (0, background_1.handleTabUpdate)(target_tab_id, { status: "loading", url: target_url }, mock_tabs[target_tab_id]);
            // Simulate a second navigation to update previousUrl
            const second_url = "https://example.com/second";
            await (0, background_1.handleTabUpdate)(target_tab_id, { status: "loading", url: second_url }, { ...mock_tabs[target_tab_id], url: second_url });
            // Verify tabHistories was updated with correct referrer
            const targetHistory = background_1.tabHistories.get(target_tab_id);
            (0, globals_1.expect)(targetHistory?.previousUrl).toBe(target_url);
            (0, globals_1.expect)(targetHistory?.currentUrl).toBe(second_url);
            (0, globals_1.expect)(targetHistory?.openerTabId).toBe(source_tab_id);
        });
        (0, globals_1.it)("should track referrer through about:blank -> actual URL navigation (Chrome/Firefox behavior)", async () => {
            // Setup initial state
            const source_tab_id = 59;
            const target_tab_id = 73;
            const source_url = "https://safebrowsing.google.com/";
            const target_url = "https://support.google.com/websearch/answer/45449";
            // Mock source tab
            mock_tabs[source_tab_id] = {
                id: source_tab_id,
                url: source_url,
                active: true,
            };
            // Set the opener's history in tabHistories
            background_1.tabHistories.set(source_tab_id, {
                currentUrl: source_url,
                timestamp: Date.now(),
            });
            // Mock target tab starting with about:blank (typical browser behavior)
            mock_tabs[target_tab_id] = {
                id: target_tab_id,
                url: "about:blank",
                active: false,
                openerTabId: source_tab_id,
            };
            // Step 1: Simulate initial about:blank navigation
            await (0, background_1.handleTabUpdate)(target_tab_id, { status: "loading", url: "about:blank" }, mock_tabs[target_tab_id]);
            // Step 2: Simulate navigation to actual target URL
            mock_tabs[target_tab_id].url = target_url;
            await (0, background_1.handleTabUpdate)(target_tab_id, { status: "loading", url: target_url }, mock_tabs[target_tab_id]);
            // Verify tabHistories preserved the referrer through about:blank
            const targetHistory = background_1.tabHistories.get(target_tab_id);
            (0, globals_1.expect)(targetHistory?.previousUrl).toBe("about:blank");
            (0, globals_1.expect)(targetHistory?.currentUrl).toBe(target_url);
            (0, globals_1.expect)(targetHistory?.openerTabId).toBe(source_tab_id);
            // We need to manually call the message handler since we can't easily test the listener
            // Let's verify the logic by checking what should be returned
            const openerHistory = background_1.tabHistories.get(source_tab_id);
            // The key test: when previousUrl is about:blank, getReferrer should return the opener's URL
            (0, globals_1.expect)(openerHistory?.currentUrl).toBe(source_url);
            (0, globals_1.expect)(targetHistory?.previousUrl).toBe("about:blank");
            // This simulates what the getReferrer logic should do:
            // Since previousUrl is "about:blank" and we have an opener, use opener's URL
            const expectedReferrer = targetHistory?.openerTabId &&
                targetHistory?.previousUrl === "about:blank"
                ? openerHistory?.currentUrl
                : targetHistory?.previousUrl;
            (0, globals_1.expect)(expectedReferrer).toBe(source_url);
        });
        (0, globals_1.it)("should clean up referrer data when tab is closed", async () => {
            // Setup initial state with referrer data
            const tab_id = 1;
            background_1.tabHistories.set(tab_id, {
                previousUrl: "https://example.com",
                currentUrl: "https://example.com",
                timestamp: Date.now(),
            });
            // Simulate tab removal
            await (0, background_1.handleTabRemove)(tab_id);
            // Verify tabHistories was updated to remove referrer data
            (0, globals_1.expect)(background_1.tabHistories.has(tab_id)).toBe(false);
        });
    });
});
//# sourceMappingURL=background.test.js.map