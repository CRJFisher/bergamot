# PKM Navigation Tracker Extension

A browser extension that tracks browsing navigation chains for personal knowledge management, with support for Single Page Applications (SPAs) and comprehensive referrer tracking.

## Architecture

The extension follows a functional programming paradigm with immutable data structures and pure functions. See [Browser Extension Functionality](../backlog/docs/browser-extension-functionality.md) for detailed documentation.

### Key Modules

- **[Tab History Manager](src/core/tab_history_manager.ts)**: Tracks navigation history per tab
- **[Navigation Detector](src/core/navigation_detector.ts)**: Detects SPA navigation via History API
- **[Data Collector](src/core/data_collector.ts)**: Collects and compresses page content
- **[Message Router](src/core/message_router.ts)**: Handles inter-component communication
- **[API Client](src/core/api_client.ts)**: Communicates with PKM server

## Features

- **Enhanced Referrer Tracking**: Maintains accurate referrer chain across navigations
- **SPA Support**: Detects pushState/replaceState navigation in single-page apps
- **Cross-Tab Tracking**: Tracks referrer when opening links in new tabs
- **Smart URL Normalization**: Removes tracking parameters for cleaner navigation detection
- **Content Compression**: Uses zstd compression for efficient storage
- **Comprehensive Testing**: 89%+ test coverage with unit and integration tests

## Installation & Testing

### 1. Build the Extension
```bash
npm run build
```

### 2. Load in Firefox for Testing

#### Method A: Firefox Developer Edition (Recommended)
1. Open Firefox Developer Edition
2. Go to `about:debugging`
3. Click "This Firefox" in the sidebar
4. Click "Load Temporary Add-on"
5. Navigate to this directory and select `manifest.json`

#### Method B: Regular Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` file

### 3. Test the Extension

1. **Open Browser Console** to see background script logs:
   - Press `F12` → Console tab
   - Or `about:debugging` → Inspect the extension

2. **Browse some websites** and check the logs:
   ```
   PKM Extension: Background script initialized
   PKM Extension: Installed and ready to track browsing chains
   ```

3. **Start your PKM server** (defaults to localhost:5000):
   ```bash
   # Example simple server
   python3 -m http.server 5000
   # Or your actual PKM backend
   ```

4. **Navigate between pages** and watch for POST requests to:
   - `/visit` - Page visits with referrer info
   - `/navigate` - Link click tracking

### 4. View Background Script Activity

Open the extension's background page console:
1. Go to `about:debugging`
2. Find your extension
3. Click "Inspect" next to the background script
4. Check the Console tab for logs

## API Endpoints

### POST /visit
Sent when a page is visited with referrer information.

```json
{
  "url": "https://example.com/page",
  "referrer": "https://google.com/search",
  "referrer_timestamp": 1749731879911,
  "content": "base64-encoded-compressed-content",
  "page_loaded_at": "2024-12-11T10:30:00Z"
}
```

Fields:
- `url`: Current page URL
- `referrer`: Previous page URL (or empty string)
- `referrer_timestamp`: When the referrer page was visited
- `content`: zstd-compressed page HTML (base64 encoded)
- `page_loaded_at`: ISO timestamp of page load

## Configuration

Set API endpoint via window object (for testing):
```javascript
window.PKM_CONFIG = { apiBaseUrl: 'http://localhost:3000' };
```

## Development

### Building
```bash
# Install dependencies
npm install

# Build extension
npm run build

# Build with test flags
npm run build:test
```

### Testing

```bash
# Run unit tests
npm run test:unit

# Run unit tests with coverage
npm run test:unit -- --coverage

# Run E2E tests (Chrome DevTools Protocol)
npm run test:cdp
npm run test:cdp:multi      # Multi-page session tests
npm run test:cdp:background  # Background state tests

# Run all tests
npm test
```

### Project Structure
```
src/
├── background.ts        # Background script entry point
├── content.ts          # Content script entry point
├── core/               # Functional modules
│   ├── api_client.ts
│   ├── configuration_manager.ts
│   ├── data_collector.ts
│   ├── message_router.ts
│   ├── navigation_detector.ts
│   └── tab_history_manager.ts
├── types/              # TypeScript types
│   └── navigation.ts
└── utils/              # Utility functions
    └── url_cleaning.ts

tests/                  # Unit tests
e2e/                   # Integration tests
``` 