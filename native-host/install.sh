#!/bin/bash

# Bergamot Native Host Installation Script
# This script installs the native messaging host for Chrome and Firefox

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_HOST_PATH="$SCRIPT_DIR/native_host.py"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================"
echo "Bergamot - Native Host Installation"
echo "================================================"

# Make native host executable
chmod +x "$NATIVE_HOST_PATH"

# Detect OS
OS="$(uname -s)"

# Function to install manifest for Chrome
install_chrome() {
    local manifest_dir
    local manifest_file="com.bergamot.native.json"
    
    case "$OS" in
        Darwin)
            manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
            ;;
        Linux)
            manifest_dir="$HOME/.config/google-chrome/NativeMessagingHosts"
            ;;
        *)
            echo -e "${RED}Unsupported OS for Chrome: $OS${NC}"
            return 1
            ;;
    esac
    
    echo -e "${YELLOW}Installing Chrome native host...${NC}"
    
    # Create directory if it doesn't exist
    mkdir -p "$manifest_dir"
    
    # Copy and update manifest
    cp "$SCRIPT_DIR/$manifest_file" "$manifest_dir/"
    
    # Update the path in the manifest
    if [[ "$OS" == "Darwin" ]]; then
        sed -i '' "s|NATIVE_HOST_PATH|$NATIVE_HOST_PATH|g" "$manifest_dir/$manifest_file"
    else
        sed -i "s|NATIVE_HOST_PATH|$NATIVE_HOST_PATH|g" "$manifest_dir/$manifest_file"
    fi
    
    echo -e "${GREEN}✓ Chrome native host installed at: $manifest_dir/$manifest_file${NC}"
}

# Function to install manifest for Firefox
install_firefox() {
    local manifest_dir
    local manifest_file="com.bergamot.native.json"
    
    case "$OS" in
        Darwin)
            manifest_dir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
            ;;
        Linux)
            manifest_dir="$HOME/.mozilla/native-messaging-hosts"
            ;;
        *)
            echo -e "${RED}Unsupported OS for Firefox: $OS${NC}"
            return 1
            ;;
    esac
    
    echo -e "${YELLOW}Installing Firefox native host...${NC}"
    
    # Create directory if it doesn't exist
    mkdir -p "$manifest_dir"
    
    # Copy manifest
    cp "$SCRIPT_DIR/$manifest_file" "$manifest_dir/"
    
    # Update the path in the manifest (Firefox version)
    if [[ "$OS" == "Darwin" ]]; then
        sed -i '' "s|NATIVE_HOST_PATH|$NATIVE_HOST_PATH|g" "$manifest_dir/$manifest_file"
        # Remove Chrome-specific fields for Firefox
        sed -i '' '/allowed_origins/d' "$manifest_dir/$manifest_file"
    else
        sed -i "s|NATIVE_HOST_PATH|$NATIVE_HOST_PATH|g" "$manifest_dir/$manifest_file"
        # Remove Chrome-specific fields for Firefox
        sed -i '/allowed_origins/d' "$manifest_dir/$manifest_file"
    fi
    
    echo -e "${GREEN}✓ Firefox native host installed at: $manifest_dir/$manifest_file${NC}"
}

# Check Python installation
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 is required but not installed.${NC}"
    exit 1
fi

# Install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"
pip3 install --user requests

# Create Bergamot directory
mkdir -p "$HOME/.bergamot"

# Install for both browsers
install_chrome
install_firefox

echo ""
echo "================================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Update the extension IDs in the manifest files:"
echo "   - Chrome: Update 'allowed_origins' with your Chrome extension ID"
echo "   - Firefox: Update 'allowed_extensions' with your Firefox extension ID"
echo ""
echo "2. Restart your browsers for changes to take effect"
echo ""
echo "3. The native host logs can be found at:"
echo "   ~/.bergamot/native-host.log"
echo ""