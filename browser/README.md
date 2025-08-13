# @bergamot/browser-extension

> Browser extension for Bergamot - Captures and tracks web browsing for knowledge management

## Overview

This browser extension works with the Bergamot VS Code extension to automatically capture and categorize webpages you visit. It tracks navigation patterns, preserves context, and sends page content for AI-powered analysis.

## Features

- 🔄 **Smart Navigation Tracking** - Captures referrer chains and navigation patterns
- 📱 **SPA Support** - Detects navigation in single-page applications
- 🗜️ **Efficient Storage** - Compresses content with zstd before sending
- 🔗 **Cross-Tab Tracking** - Maintains context when opening links in new tabs
- 🧹 **Smart URL Cleaning** - Removes tracking parameters for better deduplication

## Installation

### From Source

```bash
# Clone and build
git clone https://github.com/bergamot/bergamot.git
cd bergamot/packages/browser
npm install
npm run build
```

### Loading in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `chrome/` folder

### Loading in Firefox

1. Open `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select `firefox/manifest.json`

## Development

### Project Structure

```
packages/browser/
├── src/
│   ├── background.ts      # Service worker
│   ├── content.ts         # Content script
│   └── core/              # Core functionality
├── chrome/                # Chrome manifest
├── firefox/               # Firefox manifest
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

1. **Content Script** - Injected into every page, captures content and metadata
2. **Background Script** - Manages navigation history, processes data, sends to VS Code
3. **Message Router** - Handles communication between components
4. **API Client** - Sends captured data to VS Code extension server

## API

The extension sends data to `http://localhost:5000/visit` with:

```typescript
{
  url: string;          // Current page URL
  referrer: string;     // Previous page URL
  referrer_timestamp: number;  // When referrer was visited
  content: string;      // Compressed page content (base64)
  page_loaded_at: string;  // ISO timestamp
}
```

## Configuration

Currently configured via the VS Code extension settings. Future versions will support browser-specific settings.

## Contributing

See the main [Contributing Guide](../../CONTRIBUTING.md) in the repository root.

## License

MIT © PKM Assistant Team