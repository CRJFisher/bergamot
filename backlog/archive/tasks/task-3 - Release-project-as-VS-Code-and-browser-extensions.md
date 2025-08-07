---
id: task-3
title: Release project as VS Code and browser extensions
status: Done
assignee: []
created_date: '2025-07-29'
updated_date: '2025-08-07 03:22'
labels: []
dependencies: []
---

## Description

Package and publish the PKM Assistant as a VS Code extension to the marketplace and browser extensions to Chrome Web Store and Firefox Add-ons

## Acceptance Criteria

- [ ] VS Code extension packaged with vsce
- [ ] Browser extensions packaged for Chrome and Firefox
- [ ] Published to VS Code Marketplace
- [ ] Published to Chrome Web Store
- [ ] Published to Firefox Add-ons
- [ ] Installation instructions documented

## Implementation Plan

1. Configure VS Code extension for publishing
2. Package VS Code extension with vsce
3. Prepare browser extension manifests
4. Create distribution packages for Chrome and Firefox
5. Set up developer accounts on all platforms
6. Submit extensions for review
7. Document installation process
8. Create promotional materials

## Implementation Notes

Repository has been restructured as a monorepo. The good news is that the monorepo structure will still help with managing both extensions.

### Completed

- Monorepo structure (still useful for managing both extensions)
- Build scripts working for both packages
- VS Code extension package.json configured
- Browser extension build process working

### Next Steps for VS Code Extension

1. Install vsce: npm install -g @vscode/vsce
2. Package extension: vsce package
3. Create publisher account on VS Code Marketplace
4. Publish: vsce publish

### Next Steps for Browser Extensions

1. Create zip files for Chrome and Firefox
2. Set up Chrome Web Store developer account
3. Set up Firefox Add-ons developer account
4. Submit for review on both platforms

### Note on Changesets

Changesets are less critical for extension publishing (compared to npm), but can still be useful for version management.

Successfully restructured and packaged project for release:

Monorepo restructure:
- Flattened structure: vscode/, browser/, native-host/
- Removed nested packages/ directory
- Updated all import paths and dependencies
- Configured npm workspaces

Packaging scripts created:
- scripts/package-all.sh - Master packaging script
- scripts/package-vscode.sh - VS Code extension (.vsix)
- scripts/package-chrome.sh - Chrome extension (.zip)
- scripts/package-firefox.sh - Firefox extension (.zip)

Release artifacts:
- VS Code: pkm-assistant-{version}.vsix
- Chrome: pkm-assistant-chrome-{version}.zip
- Firefox: pkm-assistant-firefox-{version}.zip

Key changes:
- VS Code package name: pkm-assistant (not @pkm-assistant/vscode)
- Browser manifests for Chrome (v3) and Firefox
- Proper version management across all packages
- Build scripts for each platform
- Distribution folder (dist/) for releases

The project is now ready for distribution through:
- VS Code Marketplace
- Chrome Web Store
- Firefox Add-ons site
