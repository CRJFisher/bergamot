# Chrome Extension Debug Scripts

This directory contains various scripts for debugging the PKM Navigation Tracker Chrome extension. Each script serves a different purpose and has unique features.

## Available Scripts

### 1. `debug-chrome.sh` (Bash)
**Purpose**: Quick and simple Chrome debugging for Unix-like systems

**Features**:
- Automatic extension building
- VS Code extension server detection
- Temporary Chrome profile with automatic cleanup
- Color-coded output for better readability

**Usage**:
```bash
./debug-chrome.sh                        # Opens chrome://extensions
./debug-chrome.sh https://google.com     # Opens with specific URL
./debug-chrome.sh --devtools             # Auto-opens DevTools
```

**When to use**: Quick debugging sessions on Mac/Linux when you prefer simple bash scripts

### 2. `load-extension.js` (Node.js)
**Purpose**: Cross-platform Chrome extension debugging with npm integration

**Features**:
- Works on Windows, Mac, and Linux
- Can be used as a Node.js module
- Integrates with npm scripts (`npm run chrome`)
- Supports persistent Chrome profiles

**Usage**:
```bash
node load-extension.js                    # Opens chrome://extensions
node load-extension.js https://google.com # Opens with specific URL
node load-extension.js --keep-profile     # Keeps profile for next run
node load-extension.js --headless         # Run in headless mode
```

**When to use**: When you need cross-platform support or want to integrate with npm scripts

### 3. `debug-extension.py` (Python)
**Purpose**: Advanced debugging with automation framework

**Features**:
- Advanced command-line options
- Built-in testing framework
- Verbose logging support
- Better error handling and cleanup

**Usage**:
```bash
python debug-extension.py                    # Open chrome://extensions
python debug-extension.py https://google.com # Open specific URL
python debug-extension.py --auto-devtools    # Auto-open DevTools
python debug-extension.py --keep-profile     # Keep profile for next run
python debug-extension.py --headless         # Run in headless mode
python debug-extension.py --verbose          # Enable verbose logging
python debug-extension.py --test             # Run automated tests
```

**When to use**: When you need advanced debugging features, automated testing, or verbose logging

## Common Features

All scripts:
- Automatically build the extension if needed
- Create isolated Chrome profiles for testing
- Detect VS Code extension server on port 5000
- Support custom starting URLs
- Provide debugging instructions

## NPM Integration

The Node.js script is integrated with npm commands:
```bash
npm run chrome       # Launch Chrome with extension
npm run chrome:debug # Launch with auto-open DevTools
npm run debug        # Build and launch with DevTools
```

## Requirements

- **All scripts**: Chrome browser, Node.js (for building)
- **Bash script**: Unix-like system (Mac/Linux)
- **Python script**: Python 3.x

## Choosing the Right Script

| Need | Recommended Script |
|------|-------------------|
| Quick debugging on Mac/Linux | `debug-chrome.sh` |
| Cross-platform support | `load-extension.js` |
| npm script integration | `load-extension.js` |
| Automated testing | `debug-extension.py` |
| Verbose logging | `debug-extension.py` |
| Persistent profiles | `load-extension.js` or `debug-extension.py` |
| Minimal dependencies | `debug-chrome.sh` |