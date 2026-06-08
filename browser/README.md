# @bergamot/browser-extension

> Browser extension for Bergamot - Captures browsing metadata for knowledge management

## Overview

This browser extension works with the Bergamot VS Code extension to automatically capture the **metadata** of the pages you visit — never page content. It records the navigation graph (URL, title, page-load timestamp, referrer and session relationships) and sends that metadata to the local VS Code backend over HTTP. Page content is never read or transmitted; the VS Code extension re-downloads public pages later from their URLs during post-processing.

## Features

- 🔄 **Navigation Metadata** - Captures referrer chains and the navigation/session graph
- 📱 **SPA Support** - Detects `pushState`/`replaceState` navigation in single-page applications
- 🔗 **Cross-Tab Tracking** - Maintains session context when opening links in new tabs
- 🧹 **Smart URL Cleaning** - Removes tracking parameters for better deduplication
- 🔒 **Metadata only** - Never captures page content; never touches incognito tabs

## Installation

### From Source

```bash
# Clone and build
git clone https://github.com/bergamot/bergamot.git
cd bergamot/browser
npm install
npm run build
```

### Loading in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `chrome/` folder

Bergamot is Chromium-only (Chrome, Edge, or Brave).

## Development

### Project Structure

```text
browser/
├── src/
│   ├── background.ts      # Service worker
│   ├── content.ts         # Content script
│   └── core/              # Core functionality
├── chrome/                # Chrome manifest
├── e2e/                   # End-to-end tests
└── scripts/               # Debug scripts
```

### Building

```bash
# Development build
npm run build

# Watch mode
npm run watch

# Production build with tests
npm run build:test
```

### Testing

```bash
# Unit tests
npm test

# E2E tests with Chrome DevTools Protocol
npm run test:cdp

# All tests
npm run test:all
```

### Debugging

```bash
# Launch Chrome with extension loaded
npm run chrome:debug

# Or use the debug script
./scripts/debug-chrome.sh
```

## How It Works

1. **Content Script** - Injected into pages, reads visit metadata (URL, title) from the tab
2. **Background Script** - Maintains the navigation/session graph and sends metadata to VS Code
3. **Message Router** - Handles communication between components
4. **API Client** - Sends captured metadata to the VS Code extension server over local HTTP

## API

The extension sends visit metadata to `http://localhost:5000/visit` with:

```typescript
{
  url: string; // Current page URL
  referrer: string; // Previous page URL
  referrer_timestamp: number; // When referrer was visited
  page_loaded_at: string; // ISO timestamp
}
```

Page content is never included. The VS Code extension re-downloads public pages from their URLs during post-processing; pages behind a login wall fail to fetch and are excluded automatically.

## Configuration

Currently configured via the VS Code extension settings.

## Contributing

See the main [Contributing Guide](../CONTRIBUTING.md) in the repository root.

## License

MIT © Bergamot Team
