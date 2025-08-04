# Browser Extension Project Structure Documentation

## Overview

The PKM Navigation Tracker is a browser extension that tracks browsing navigation chains for personal knowledge management. It supports both Chrome and Firefox browsers using Manifest V3.

## Project Directory Structure

```
referrer_tracker_extension/
├── chrome/                  # Chrome-specific files
│   ├── dist/               # Built extension files (generated)
│   └── manifest.json       # Chrome manifest configuration
├── firefox/                # Firefox-specific files
│   ├── dist/               # Built extension files (generated)
│   └── manifest.json       # Firefox manifest configuration
├── dist/                   # Main build output directory
├── e2e/                    # End-to-end tests
│   ├── comprehensive-extension.spec.ts
│   ├── fixtures.ts
│   └── fixtures/
│       └── mock-server.ts  # Mock PKM server for testing
├── src/                    # Source code
│   ├── background.ts       # Background service worker
│   ├── content.ts          # Content script
│   └── url_cleaning.ts     # URL processing utilities
├── tests/                  # Unit tests
│   ├── background.test.ts
│   └── setup.ts           # Test setup configuration
├── build-for-test.js       # Build script for test environment
├── copy-dist-to-browser-folders.js  # Deploy script to browser folders
├── package.json            # Project configuration
├── playwright.config.ts    # E2E test configuration
├── tsconfig.json          # TypeScript configuration
└── tsconfig.browser.json  # Browser-specific TypeScript config
```

## Build Process

### Build Scripts

The project uses ESBuild for bundling TypeScript code:

1. **Regular Build** (`npm run build`):
   - Bundles `src/content.ts` → `dist/content.bundle.js` (IIFE format)
   - Bundles `src/background.ts` → `dist/background.bundle.js` (ESM format)
   - Post-build: Copies dist to browser-specific folders

2. **Test Build** (`npm run build:test`):
   - Finds a free port for mock server
   - Saves port to `test-port.txt`
   - Builds with `MOCK_PKM_PORT` defined for test environment
   - Post-build: Same copy process

### Build Configuration

- **TypeScript**: Two config files
  - `tsconfig.json`: Main configuration
  - `tsconfig.browser.json`: Browser-specific settings
- **ESBuild**: Fast bundler with TypeScript support
- **Output formats**:
  - Content script: IIFE (Immediately Invoked Function Expression)
  - Background script: ESM (ES Modules)

## Testing Setup

### Testing Framework

- **Unit Tests**: Jest with ts-jest
  - Test files: `tests/*.test.ts`
  - Setup file: `tests/setup.ts`
  - Environment: Node.js

- **E2E Tests**: Playwright
  - Test files: `e2e/*.spec.ts`
  - Configuration: `playwright.config.ts`
  - Browser: Chromium only (extension testing limitation)

### Testing Commands

- `npm test`: Runs both unit and E2E tests
- `npm run test:unit`: Jest unit tests only
- `npm run test:e2e`: Playwright E2E tests (builds first)

### Current Testing Limitations

1. **Playwright State Persistence**: 
   - Extension state is not persisted between page navigations
   - Each navigation creates a new extension context
   - Cannot test multi-page sessions or background script state tracking

2. **Browser Support**:
   - E2E tests only run in Chromium
   - Firefox extension testing not supported by Playwright

3. **Test Isolation**:
   - Tests run with `fullyParallel: false` and `workers: 1`
   - Required for extension testing stability

## Extension Functionality

### Core Features

1. **Navigation Tracking**:
   - Tracks page visits with referrer information
   - Monitors link clicks for navigation chains
   - Maintains per-tab navigation history

2. **Data Collection**:
   - Current URL and timestamp
   - Referrer URL and timestamp
   - Navigation chains across tabs

3. **API Integration**:
   - POST `/visit`: Reports page visits
   - POST `/navigate`: Reports link clicks
   - Default endpoint: `http://localhost:5000`

### Permissions

- `scripting`: Inject content scripts
- `webRequest`: Monitor navigation events
- `tabs`: Access tab information
- `activeTab`: Current tab access
- `<all_urls>`: Track all websites

### Components

1. **Background Script** (`background.ts`):
   - Service worker (Chrome) / Background script (Firefox)
   - Manages per-tab navigation state
   - Handles cross-tab tracking

2. **Content Script** (`content.ts`):
   - Injected into all pages
   - Captures link clicks
   - Reports navigation events

3. **URL Cleaning** (`url_cleaning.ts`):
   - Normalizes URLs
   - Removes tracking parameters
   - Handles edge cases

## Dependencies

### Runtime Dependencies
- `@hpcc-js/wasm-zstd`: Compression library
- `cheerio`: HTML parsing
- `webextension-polyfill`: Cross-browser API compatibility

### Development Dependencies
- TypeScript toolchain
- Jest for unit testing
- Playwright for E2E testing
- ESBuild for bundling
- Browser type definitions

## Configuration

- **API Endpoint**: Configurable via `window.PKM_CONFIG`
- **Browser Compatibility**: Manifest V3 for Chrome/Firefox
- **Extension ID**: `pkm-assistant@example.com` (Firefox)