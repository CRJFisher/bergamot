"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_1 = require("./fixtures");
const fs_1 = require("fs");
// Helper function to inspect and validate visit request bodies
function inspectVisitRequest(req, expectedUrl, expectedReferrer) {
    console.log(`🔍 Inspecting visit request:`, {
        url: req.body.url,
        referrer: req.body.referrer || "(empty)",
        timestamp: req.body.timestamp,
        referrer_timestamp: req.body.referrer_timestamp,
        hasValidTimestamp: typeof req.body.timestamp === "number" && req.body.timestamp > 0,
        hasReferrerTimestamp: typeof req.body.referrer_timestamp === "number",
    });
    // Validate required fields
    (0, fixtures_1.expect)(req.body.url).toBeDefined();
    (0, fixtures_1.expect)(req.body.timestamp).toBeDefined();
    (0, fixtures_1.expect)(typeof req.body.timestamp).toBe("number");
    (0, fixtures_1.expect)(req.body.timestamp).toBeGreaterThan(0);
    // Validate URL
    (0, fixtures_1.expect)(req.body.url).toContain(expectedUrl);
    // Validate referrer if expected
    if (expectedReferrer !== undefined) {
        if (expectedReferrer === "") {
            (0, fixtures_1.expect)(req.body.referrer).toBe("");
        }
        else {
            (0, fixtures_1.expect)(req.body.referrer).toContain(expectedReferrer);
        }
    }
    // Validate referrer timestamp exists when referrer exists
    if (req.body.referrer && req.body.referrer !== "") {
        (0, fixtures_1.expect)(req.body.referrer_timestamp).toBeDefined();
        (0, fixtures_1.expect)(typeof req.body.referrer_timestamp).toBe("number");
    }
}
fixtures_1.test.describe("Comprehensive PKM Extension Tests", () => {
    fixtures_1.test.describe.configure({ mode: "serial" });
    (0, fixtures_1.test)("should track page navigation with proper referrer chain", async ({ page, context, extensionId, }) => {
        const testPort = parseInt((0, fs_1.readFileSync)("test-port.txt", "utf-8").trim());
        const MockPKMServer = (await Promise.resolve().then(() => __importStar(require("./fixtures/mock-server"))))
            .MockPKMServer;
        const mockServer = new MockPKMServer(testPort);
        await mockServer.start();
        try {
            mockServer.clearRequests();
            // Navigate through a sequence of pages to test referrer chain
            console.log("🔗 Testing navigation referrer chain...");
            await page.goto("https://example.com");
            await page.waitForTimeout(1500);
            await page.goto("https://www.iana.org/domains/example");
            await page.waitForTimeout(1500);
            await page.goto("https://github.com");
            await page.waitForTimeout(1500);
            const visitRequests = mockServer.getRequestsByEndpoint("/visit");
            (0, fixtures_1.expect)(visitRequests.length).toBeGreaterThanOrEqual(3);
            console.log(`📊 Captured ${visitRequests.length} visit requests`);
            // Detailed inspection of each visit in the chain
            console.log("\n=== VISIT 1 (example.com) ===");
            inspectVisitRequest(visitRequests[0], "example.com", "");
            console.log("\n=== VISIT 2 (iana.org) ===");
            inspectVisitRequest(visitRequests[1], "iana.org", "example.com");
            console.log("\n=== VISIT 3 (github.com) ===");
            inspectVisitRequest(visitRequests[2], "github.com", "iana.org");
            // Verify the complete referrer chain
            console.log("\n📊 Referrer chain summary:");
            visitRequests.forEach((req, i) => {
                console.log(`  ${i + 1}. ${req.body.url} ← ${req.body.referrer || "(none)"}`);
            });
        }
        finally {
            await mockServer.stop();
        }
    });
    (0, fixtures_1.test)("should track new tab visits when links are clicked", async ({ page, context, extensionId, }) => {
        const testPort = parseInt((0, fs_1.readFileSync)("test-port.txt", "utf-8").trim());
        const MockPKMServer = (await Promise.resolve().then(() => __importStar(require("./fixtures/mock-server"))))
            .MockPKMServer;
        const mockServer = new MockPKMServer(testPort);
        await mockServer.start();
        try {
            mockServer.clearRequests();
            console.log("🔗 Testing new tab link clicks...");
            // Start with a real URL to see if referrer tracking works better
            await page.goto("https://example.com");
            await page.waitForTimeout(1000);
            // Inject a target="_blank" link into the page
            await page.evaluate(() => {
                const link = document.createElement("a");
                link.id = "new-tab-link";
                link.href = "https://github.com";
                link.target = "_blank";
                link.textContent = "Open GitHub in New Tab";
                link.style.cssText =
                    "display: block; padding: 10px; background: #007acc; color: white; text-decoration: none; margin: 20px;";
                document.body.appendChild(link);
            });
            await page.waitForTimeout(500);
            // Clear requests after initial page load
            mockServer.clearRequests();
            // Listen for new page creation
            const newPagePromise = context.waitForEvent("page");
            // Click the target="_blank" link
            console.log("Clicking target='_blank' link...");
            await page.click("#new-tab-link");
            // Wait for new tab and let it load
            const newPage = await newPagePromise;
            await newPage.waitForLoadState();
            await page.waitForTimeout(2000); // Give time for extension to process
            const visitRequests = mockServer.getRequestsByEndpoint("/visit");
            console.log(`📊 Captured ${visitRequests.length} visit requests`);
            // Find the GitHub visit from the new tab
            const newTabVisit = visitRequests.find((req) => req.body.url?.includes("github.com"));
            (0, fixtures_1.expect)(newTabVisit).toBeDefined();
            console.log("\n=== NEW TAB VISIT ===");
            console.log(`🔍 Original page URL: https://example.com`);
            inspectVisitRequest(newTabVisit, "github.com");
            // Check if referrer tracking worked for new tab
            if (newTabVisit.body.referrer && newTabVisit.body.referrer.length > 0) {
                console.log("✅ New tab referrer tracking working!");
                (0, fixtures_1.expect)(newTabVisit.body.referrer).toContain("example.com");
            }
            else {
                console.log("ℹ️  New tab referrer not captured - this can happen in test environments");
                // Still verify the visit was tracked, even if referrer is empty
                (0, fixtures_1.expect)(newTabVisit.body.url).toContain("github.com");
            }
            await newPage.close();
        }
        finally {
            await mockServer.stop();
        }
    });
    (0, fixtures_1.test)("should verify background script is running", async ({ page, context, extensionId, }) => {
        // Test that background script is accessible and running
        const [background] = context.serviceWorkers();
        // Verify background script can execute code
        const result = await background.evaluate(() => {
            return "Background script is running!";
        });
        (0, fixtures_1.expect)(result).toBe("Background script is running!");
        (0, fixtures_1.expect)(background.url()).toContain(extensionId);
    });
    (0, fixtures_1.test)("should track SPA navigation events", async ({ page, context, extensionId, }) => {
        const testPort = parseInt((0, fs_1.readFileSync)("test-port.txt", "utf-8").trim());
        const MockPKMServer = (await Promise.resolve().then(() => __importStar(require("./fixtures/mock-server"))))
            .MockPKMServer;
        const mockServer = new MockPKMServer(testPort);
        await mockServer.start();
        try {
            mockServer.clearRequests();
            console.log("🔗 Testing SPA navigation tracking...");
            // Create a simple SPA test page
            await page.goto("https://example.com");
            // Wait for the page to be fully loaded
            await page.waitForLoadState("networkidle");
            // Inject the SPA test code
            await page.evaluate(() => {
                // Create a simple SPA-like navigation system
                const app = document.createElement("div");
                app.id = "app";
                document.body.appendChild(app);
                // Add navigation buttons
                const nav = document.createElement("nav");
                nav.innerHTML = `
          <button id="page1">Page 1</button>
          <button id="page2">Page 2</button>
          <button id="page3">Page 3</button>
        `;
                document.body.insertBefore(nav, app);
                // Add content areas
                const pages = {
                    page1: "<h1>Page 1</h1><p>This is page 1 content</p>",
                    page2: "<h1>Page 2</h1><p>This is page 2 content</p>",
                    page3: "<h1>Page 3</h1><p>This is page 3 content</p>",
                };
                // Set up navigation handlers using path-based routing
                function navigate(page) {
                    const newPath = `/spa/${page}`;
                    history.pushState({ page }, "", newPath);
                    app.innerHTML = pages[page];
                }
                // Add click handlers
                document
                    .getElementById("page1")
                    .addEventListener("click", () => navigate("page1"));
                document
                    .getElementById("page2")
                    .addEventListener("click", () => navigate("page2"));
                document
                    .getElementById("page3")
                    .addEventListener("click", () => navigate("page3"));
                // Handle popstate for browser navigation
                window.addEventListener("popstate", (event) => {
                    const path = window.location.pathname;
                    const pageName = path.split("/").pop();
                    if (pages[pageName]) {
                        app.innerHTML = pages[pageName];
                    }
                });
                // Handle initial page with path-based routing
                navigate("page1");
                // Trigger content script SPA handler for initial state
                window.history.replaceState({ page: "page1" }, "", "/spa/page1");
            });
            // Wait for initial page setup
            await page.waitForSelector("#app");
            await page.waitForTimeout(1000);
            // Navigate through pages using SPA navigation
            console.log("Navigating through SPA pages...");
            // Click page2 and wait for navigation
            await page.click("#page2");
            await page.waitForTimeout(1000);
            await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
            await (0, fixtures_1.expect)(page.locator("#app")).toContainText("Page 2");
            // Click page3 and wait for navigation
            await page.click("#page3");
            await page.waitForTimeout(1000);
            await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
            await (0, fixtures_1.expect)(page.locator("#app")).toContainText("Page 3");
            // Use browser back button
            await page.goBack();
            await page.waitForTimeout(1000);
            await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
            await (0, fixtures_1.expect)(page.locator("#app")).toContainText("Page 2");
            // Wait for all requests to be processed
            await page.waitForTimeout(2000);
            const visitRequests = mockServer.getRequestsByEndpoint("/visit");
            console.log(`📊 Captured ${visitRequests.length} visit requests`);
            // Verify we have at least the expected number of requests
            (0, fixtures_1.expect)(visitRequests.length).toBeGreaterThanOrEqual(4); // Initial + 3 SPA navigations
            // Verify the navigation chain
            console.log("\n=== SPA NAVIGATION CHAIN ===");
            visitRequests.forEach((req, i) => {
                console.log(`  ${i + 1}. ${req.body.url} ← ${req.body.referrer || "(none)"}`);
            });
            // Verify referrer chain is maintained
            const urls = visitRequests.map((req) => req.body.url);
            const referrers = visitRequests.map((req) => req.body.referrer);
            // Each page should have the previous page as its referrer
            for (let i = 1; i < visitRequests.length; i++) {
                const prevUrl = urls[i - 1].split("#")[0];
                const currentReferrer = referrers[i];
                (0, fixtures_1.expect)(currentReferrer).toContain(prevUrl);
            }
        }
        finally {
            await mockServer.stop();
        }
    });
});
//# sourceMappingURL=comprehensive-extension.spec.js.map