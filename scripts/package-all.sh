#!/bin/bash

# PKM Assistant - Package All Extensions Script
# This script packages all extensions (VS Code, Chrome, Firefox) for release

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[→]${NC} $1"
}

# Get the root directory
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================"
echo "PKM Assistant - Extension Packaging Script"
echo "================================================"

# Clean up old packages
print_info "Cleaning up old packages..."
rm -f vscode/*.vsix
rm -f browser/*.zip
print_status "Old packages cleaned"

# Package VS Code Extension
echo ""
echo "📦 Packaging VS Code Extension..."
echo "--------------------------------"
cd "$ROOT_DIR/vscode"

print_info "Compiling TypeScript..."
npm run compile || { print_error "VS Code compilation failed"; exit 1; }
print_status "TypeScript compiled"

print_info "Running vsce package..."
npm run package || { print_error "VS Code packaging failed"; exit 1; }
print_status "VS Code extension packaged"

# Find the created VSIX file
VSIX_FILE=$(ls *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX_FILE" ]; then
    print_status "Created: vscode/$VSIX_FILE"
else
    print_error "VSIX file not found"
fi

# Package Browser Extensions
echo ""
echo "📦 Packaging Browser Extensions..."
echo "----------------------------------"
cd "$ROOT_DIR/browser"

print_info "Building browser extension..."
npm run build || { print_error "Browser extension build failed"; exit 1; }
print_status "Browser extension built"

# Package Chrome Extension
print_info "Packaging Chrome extension..."
cd chrome
zip -r ../chrome-extension.zip . -x "*.DS_Store" "node_modules/*" > /dev/null 2>&1
cd ..
print_status "Chrome extension packaged: browser/chrome-extension.zip"

# Package Firefox Extension
print_info "Packaging Firefox extension..."
cd firefox
zip -r ../firefox-extension.zip . -x "*.DS_Store" "node_modules/*" > /dev/null 2>&1
cd ..
print_status "Firefox extension packaged: browser/firefox-extension.zip"

# Summary
echo ""
echo "================================================"
echo "📋 Package Summary"
echo "================================================"
echo ""
echo "✅ VS Code Extension:"
if [ -n "$VSIX_FILE" ]; then
    echo "   → $ROOT_DIR/vscode/$VSIX_FILE"
    echo "   → Size: $(du -h "$ROOT_DIR/vscode/$VSIX_FILE" | cut -f1)"
fi
echo ""
echo "✅ Chrome Extension:"
echo "   → $ROOT_DIR/browser/chrome-extension.zip"
echo "   → Size: $(du -h "$ROOT_DIR/browser/chrome-extension.zip" | cut -f1)"
echo ""
echo "✅ Firefox Extension:"
echo "   → $ROOT_DIR/browser/firefox-extension.zip"
echo "   → Size: $(du -h "$ROOT_DIR/browser/firefox-extension.zip" | cut -f1)"
echo ""
echo "================================================"
echo "🚀 All extensions packaged successfully!"
echo "================================================"
echo ""
echo "Next steps:"
echo "  1. Test the packaged extensions"
echo "  2. VS Code: Upload to VS Code Marketplace"
echo "  3. Chrome: Upload to Chrome Web Store"
echo "  4. Firefox: Upload to Firefox Add-ons"