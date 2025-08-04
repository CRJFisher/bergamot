"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expect = exports.test = void 0;
const test_1 = require("@playwright/test");
const path_1 = __importDefault(require("path"));
exports.test = test_1.test.extend({
    context: async ({}, use) => {
        // Path to the chrome extension directory
        const pathToExtension = path_1.default.join(process.cwd(), "chrome");
        console.log(`Loading extension from: ${pathToExtension}`);
        const context = await test_1.chromium.launchPersistentContext("", {
            channel: "chromium",
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
            ],
        });
        try {
            await use(context);
        }
        finally {
            await context.close();
        }
    },
    extensionId: async ({ context }, use) => {
        // For manifest v3:
        let [background] = context.serviceWorkers();
        if (!background)
            background = await context.waitForEvent("serviceworker");
        const extensionId = background.url().split("/")[2];
        console.log(`Extension ID: ${extensionId}`);
        await use(extensionId);
    },
});
exports.expect = exports.test.expect;
//# sourceMappingURL=fixtures.js.map