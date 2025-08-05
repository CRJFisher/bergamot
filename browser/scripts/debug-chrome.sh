#!/bin/bash

# Chrome Extension Debug Script (Bash) - Simple Chrome launcher with extension
# 
# PURPOSE:
# - Quick and simple Chrome debugging for Unix-like systems (Mac/Linux)
# - Minimal dependencies (just bash and Chrome)
# - Designed for interactive debugging sessions
# - Automatic cleanup of temporary Chrome profile
# 
# FEATURES:
# - Automatic extension building
# - VS Code extension server detection
# - Temporary Chrome profile creation and cleanup
# - Command-line options for DevTools and custom URLs
# - Color-coded output for better readability
# - Signal handling for proper cleanup
# 
# USAGE:
#   ./scripts/debug-chrome.sh                        # Opens chrome://extensions
#   ./scripts/debug-chrome.sh https://google.com     # Opens with specific URL
#   ./scripts/debug-chrome.sh --devtools             # Auto-opens DevTools
#   ./scripts/debug-chrome.sh --url https://site.com # Specify URL with flag
# 
# WHEN TO USE:
# - Quick debugging sessions on Mac/Linux
# - When you prefer simple bash scripts
# - For temporary debugging (profile is cleaned up)
# - When you don't need cross-platform support

set -e

# Adjusted for new location in scripts/
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CHROME_EXT_DIR="$(dirname "$SCRIPT_DIR")"
CHROME_USER_DATA_DIR="/tmp/pkm-chrome-debug-profile"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 PKM Chrome Extension Debugger${NC}"
echo "================================"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    
    # Clean up temp profile
    if [ -d "$CHROME_USER_DATA_DIR" ]; then
        rm -rf "$CHROME_USER_DATA_DIR"
    fi
    
    echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Set up trap for cleanup
trap cleanup EXIT INT TERM

# Step 1: Build Chrome Extension
echo -e "\n${YELLOW}📦 Building Chrome Extension...${NC}"
cd "$CHROME_EXT_DIR"
npm run build || {
    echo -e "${RED}❌ Failed to build Chrome extension${NC}"
    exit 1
}
echo -e "${GREEN}✅ Chrome extension built${NC}"

# Step 2: Check if VS Code extension is running
echo -e "\n${YELLOW}🔍 Checking for VS Code extension...${NC}"
if curl -s http://localhost:5000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ VS Code extension detected on port 5000${NC}"
else
    echo -e "${YELLOW}⚠️  VS Code extension not detected on port 5000${NC}"
    echo "   Make sure to run the VS Code extension from your IDE"
fi

# Step 3: Find Chrome
if [[ "$OSTYPE" == "darwin"* ]]; then
    CHROME_EXEC="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [ ! -f "$CHROME_EXEC" ]; then
        CHROME_EXEC="/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    fi
else
    CHROME_EXEC=$(which google-chrome || which google-chrome-stable || which chromium || which chromium-browser || echo "")
fi

if [ -z "$CHROME_EXEC" ] || [ ! -f "$CHROME_EXEC" ]; then
    echo -e "${RED}❌ Chrome not found${NC}"
    exit 1
fi

# Step 4: Launch Chrome with Extension
echo -e "\n${YELLOW}🌐 Launching Chrome with Extension...${NC}"
mkdir -p "$CHROME_USER_DATA_DIR"

# Parse command line arguments
AUTO_DEVTOOLS=""
START_URL="chrome://extensions"

while [[ $# -gt 0 ]]; do
    case $1 in
        --devtools)
            AUTO_DEVTOOLS="--auto-open-devtools-for-tabs"
            shift
            ;;
        --url)
            START_URL="$2"
            shift 2
            ;;
        *)
            START_URL="$1"
            shift
            ;;
    esac
done

"$CHROME_EXEC" \
    --user-data-dir="$CHROME_USER_DATA_DIR" \
    --load-extension="$CHROME_EXT_DIR/chrome" \
    $AUTO_DEVTOOLS \
    --disable-blink-features=AutomationControlled \
    --no-first-run \
    --no-default-browser-check \
    "$START_URL" &

CHROME_PID=$!

echo -e "${GREEN}✅ Chrome launched (PID: $CHROME_PID)${NC}"

# Step 5: Show instructions
echo -e "\n${BLUE}📊 Debug Status:${NC}"
echo "================="
echo -e "Chrome Extension:  ${GREEN}Loaded${NC}"
echo -e "Chrome Profile:    $CHROME_USER_DATA_DIR"
echo -e "Extension Path:    $CHROME_EXT_DIR/chrome"
echo ""
echo -e "${BLUE}📝 Debugging Instructions:${NC}"
echo "========================="
echo "1. In Chrome, go to chrome://extensions"
echo "2. Find 'PKM Navigation Tracker'"
echo "3. Click 'service worker' to debug background script"
echo "4. Press F12 on any webpage to debug content script"
echo ""
echo -e "${BLUE}🔍 Verify it's working:${NC}"
echo "======================="
echo "1. Open DevTools on the service worker"
echo "2. Check Console tab for 'Page loaded:' messages"
echo "3. Check Network tab for POST to http://localhost:5000/visit"
echo ""
echo -e "${YELLOW}Waiting for Chrome to close...${NC}"

# Wait for Chrome to exit
wait $CHROME_PID

echo -e "\n${GREEN}Chrome closed. Exiting...${NC}"