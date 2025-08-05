# Chrome Extension Debugging Guide

This guide covers how to build, load, and debug the PKM Navigation Tracker Chrome extension.

## Prerequisites

1. **Node.js** installed for building the extension
2. **Google Chrome** browser installed
3. **VS Code extension running** (if testing with the backend):
   - Open the PKM Assistant project in VS Code
   - Press F5 to run the extension
   - Wait for "PKM Assistant server running at http://localhost:5000"

## Quick Start

### Option 1: Automated Script (Recommended)

From the `referrer_tracker_extension` directory:
```bash
./scripts/debug-chrome.sh
```

This script will:
- Build the Chrome extension
- Check if VS Code extension is running
- Launch Chrome with the extension pre-loaded
- Wait for Chrome to close before cleaning up

### Option 2: NPM Commands

From the `referrer_tracker_extension` directory:
```bash
npm run debug    # Build + launch Chrome with DevTools
npm run chrome   # Just launch Chrome
```

### Option 3: Manual Loading

1. Build the extension:
   ```bash
   cd referrer_tracker_extension
   npm install
   npm run build
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked" and select:
   `/Users/chuck/workspace/pkm-assistant/referrer_tracker_extension/chrome`

## Debugging the Extension

### Background Script (Service Worker)

1. In Chrome, go to `chrome://extensions/`
2. Find "PKM Navigation Tracker"
3. Click "service worker" link
4. This opens dedicated DevTools for the background script
5. Check:
   - **Console tab**: For "Page loaded:" messages
   - **Network tab**: For POST requests to `http://localhost:5000/visit`

### Content Script

1. Navigate to any webpage
2. Open DevTools (F12 or right-click → Inspect)
3. In the **Console tab**, you'll see content script logs
4. In the **Sources tab**, find:
   - `chrome-extension://[extension-id]/dist/content.bundle.js`

### Verifying It's Working

1. Make sure VS Code extension is running (port 5000)
2. Visit any webpage
3. Check background script console for:
   ```
   Page loaded: https://example.com
   Sending page data to local server
   ```
4. Check Network tab for POST to `http://localhost:5000/visit`

## Available Scripts

All scripts are located in `referrer_tracker_extension/scripts/`:

### Bash Script (`scripts/debug-chrome.sh`)
- Platform: Mac/Linux
- Features: Auto-build, VS Code detection, cleanup on exit
- Usage: `./scripts/debug-chrome.sh [URL]`
- Options: `./scripts/debug-chrome.sh --devtools https://example.com`
- When to use: Quick debugging sessions on Unix-like systems

### Node.js Script (`scripts/load-extension.js`)
- Platform: Cross-platform (Windows, Mac, Linux)
- Features: npm integration, module exports, persistent profiles
- Usage: `node scripts/load-extension.js [URL]`
- Options: 
  - `--keep-profile` to persist Chrome profile
  - `--headless` for headless mode
- When to use: Cross-platform needs, npm script integration

### Python Script (`scripts/debug-extension.py`)
- Platform: Cross-platform with Python
- Features: Advanced debugging, automated testing framework
- Usage: `python scripts/debug-extension.py [URL]`
- Options:
  - `--auto-devtools`: Auto-open DevTools
  - `--keep-profile`: Persistent profile
  - `--headless`: Run in headless mode
  - `--verbose`: Enable verbose logging
  - `--test`: Run automated tests
- When to use: Advanced debugging, automated testing, verbose logging

## Troubleshooting

### Extension Not Loading
- Ensure `npm run build` has been run
- Check `manifest.json` is valid
- Verify Chrome version ≥ 88 (Manifest V3 requirement)

### No Logs Appearing
- Refresh the extension (click refresh icon on extension card)
- Check you're viewing the correct console (background vs content)
- Ensure the extension is enabled

### Network Requests Failing
- Verify VS Code extension is running on port 5000
- Check for CORS errors in console
- Look for mixed content warnings

### Content Script Not Running
- Check the URL matches manifest permissions
- Look for JavaScript errors in page console
- Verify the page has finished loading

## Chrome URLs for Debugging

- `chrome://extensions/` - Extension management
- `chrome://inspect/#service-workers` - All service workers
- `chrome://net-export/` - Network log export
- `chrome://extensions/shortcuts` - Keyboard shortcuts

## Development Tips

1. **Auto-reload**: Click the refresh icon on the extension card after code changes

2. **Console Logging**: 
   - Background script logs appear in service worker DevTools
   - Content script logs appear in the webpage console

3. **Debugging State**: Use Chrome DevTools Application tab to inspect:
   - Local Storage
   - IndexedDB
   - Service Worker state

4. **Performance**: Use Performance tab to profile extension impact

## Script Details

All debugging scripts:
- Automatically build the extension if needed
- Create a temporary Chrome profile (isolated from your main profile)
- Clean up temporary files on exit
- Support command-line arguments for URLs

The temporary profile ensures:
- Clean testing environment
- No interference with your personal Chrome data
- Automatic cleanup after testing