# Bergamot - Build & Packaging Scripts

This directory contains scripts for building, packaging, and releasing the Bergamot extensions.

## Packaging Scripts

### `package-all.sh` (Unix/Mac/Linux)
Bash script that packages all extensions with colored output and progress indicators.

```bash
./scripts/package-all.sh
```

### `package-all.js` (Cross-platform)
Node.js script for cross-platform packaging support.

```bash
node scripts/package-all.js
```

### NPM Scripts
You can also use npm scripts from the root directory:

```bash
# Package all extensions at once
npm run package:all

# Package individual extensions
npm run package:vscode
npm run package:chrome
npm run package:firefox

# Complete release preparation (clean, install, build, package)
npm run release:prepare
```

## Output Locations

After running the packaging scripts, you'll find:

- **VS Code Extension**: `vscode/bergamot-*.vsix`
- **Chrome Extension**: `browser/chrome-extension.zip`
- **Firefox Extension**: `browser/firefox-extension.zip`

## Publishing Instructions

### VS Code Marketplace
1. Install vsce globally: `npm install -g @vscode/vsce`
2. Create a Personal Access Token on Azure DevOps
3. Publish: `vsce publish -p <token>`

### Chrome Web Store
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload `browser/chrome-extension.zip`
3. Fill in store listing details
4. Submit for review

### Firefox Add-ons
1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Upload `browser/firefox-extension.zip`
3. Fill in add-on details
4. Submit for review

## Testing Before Release

### VS Code Extension
```bash
# Install locally
code --install-extension vscode/bergamot-*.vsix
```

### Chrome Extension
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Drag and drop `browser/chrome-extension.zip`

### Firefox Extension
1. Open `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select the zip file