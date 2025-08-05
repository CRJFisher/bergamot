---
id: task-13
title: Create automated Chrome extension debugging scripts
status: Done
assignee: []
created_date: '2025-08-05 10:53'
updated_date: '2025-08-05 10:53'
labels: []
dependencies: []
---

## Description

Create scripts to automate the loading and debugging of the Chrome extension. This eliminates the manual process of loading unpacked extensions through chrome://extensions and provides a consistent debugging environment. The scripts should build the extension, create a temporary Chrome profile, and launch Chrome with the extension pre-loaded.

## Acceptance Criteria

- [x] Bash script for Mac/Linux Chrome debugging
- [x] Node.js cross-platform script
- [x] Python script with advanced features
- [x] NPM scripts for easy access
- [x] Automatic extension building
- [x] Temporary Chrome profile creation
- [x] Cleanup on exit
- [x] VS Code extension detection

## Implementation Plan

1. Research Chrome command-line flags for extension loading
2. Create bash script for Unix systems
3. Create Node.js script for cross-platform support
4. Create Python script with enhanced features
5. Add NPM scripts to package.json
6. Write comprehensive documentation
7. Test on different platforms

## Implementation Notes

### Scripts Created

1. **`debug-chrome.sh`** (Main bash script)
   - Located at project root
   - Builds Chrome extension using npm
   - Checks if VS Code extension is running on port 5000
   - Finds Chrome executable based on OS
   - Creates temporary profile in `/tmp/pkm-chrome-debug-profile`
   - Launches Chrome with `--load-extension` flag
   - Waits for Chrome process to exit before cleanup
   - Supports command-line arguments for URL and --devtools flag

2. **`load-extension.js`** (Node.js script)
   - Located in `referrer_tracker_extension/`
   - Cross-platform Chrome detection (Windows, Mac, Linux)
   - Automatic extension building if not built
   - Temporary or persistent profile support
   - Command-line argument parsing
   - HTTP check for VS Code extension
   - Process management with proper cleanup

3. **`debug-extension.py`** (Python script)
   - Located in `referrer_tracker_extension/`
   - Most feature-rich implementation
   - Supports headless mode for testing
   - Keep-profile option for persistent debugging
   - Verbose logging support
   - Automated test mode
   - Platform-specific Chrome path detection

4. **NPM Scripts** (Added to package.json)
   ```json
   "chrome": "node load-extension.js",
   "chrome:debug": "node load-extension.js --auto-open-devtools-for-tabs",
   "debug": "npm run build && npm run chrome:debug"
   ```

### Key Features Implemented

- **Automatic Building**: All scripts check if extension is built and run `npm run build` if needed
- **Chrome Detection**: Smart detection of Chrome across different OS and installation paths
- **Temporary Profiles**: Creates isolated Chrome profile for testing, cleaned up on exit
- **VS Code Detection**: Checks if VS Code extension server is running on port 5000
- **Process Management**: Proper handling of Chrome process lifecycle
- **Signal Handling**: Cleanup on Ctrl+C or script termination

### Documentation

- **`CHROME_DEBUG_INSTRUCTIONS.md`**: Comprehensive guide for manual and automated debugging
- **`QUICK_START_CHROME.md`**: Quick reference for getting started
- **`README_DEBUG.md`**: Overview of all debugging options and scripts

### Technical Decisions

1. **No VS Code Server Integration**: Scripts only check for VS Code extension, don't start it
   - Allows developers to debug VS Code extension in their IDE
   - Keeps concerns separated

2. **Temporary Profiles**: Used by default to avoid conflicts with user's Chrome profile
   - Can be overridden with --keep-profile option

3. **Chrome Command-Line Flags**:
   - `--load-extension`: Loads unpacked extension
   - `--user-data-dir`: Specifies profile directory
   - `--auto-open-devtools-for-tabs`: Optional DevTools auto-open
   - `--disable-blink-features=AutomationControlled`: Prevents automation detection

### Files Modified/Created

- `/debug-chrome.sh` - Main bash script
- `/referrer_tracker_extension/load-extension.js` - Node.js script
- `/referrer_tracker_extension/debug-extension.py` - Python script
- `/referrer_tracker_extension/package.json` - Added npm scripts
- `/referrer_tracker_extension/CHROME_DEBUG_INSTRUCTIONS.md` - Manual instructions
- `/referrer_tracker_extension/QUICK_START_CHROME.md` - Quick start guide
- `/referrer_tracker_extension/README_DEBUG.md` - Complete debugging guide
