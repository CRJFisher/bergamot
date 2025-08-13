# VS Code Extension Publishing Guide

This guide covers the complete process of publishing the Bergamot VS Code extension to various marketplaces.

## Table of Contents

- [Marketplaces](#marketplaces)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Build Process](#build-process)
- [Publishing Workflow](#publishing-workflow)
- [Manual Publishing](#manual-publishing)
- [Alternative Distribution](#alternative-distribution)
- [Troubleshooting](#troubleshooting)

## Marketplaces

### 1. VS Code Marketplace (Official)

- **URL**: https://marketplace.visualstudio.com
- **Users**: 30+ million developers
- **Requirements**: Azure DevOps account, Personal Access Token
- **Publishing Tool**: vsce CLI
- **Review Time**: Usually instant, sometimes up to 24 hours

### 2. Open VSX Registry

- **URL**: https://open-vsx.org
- **Users**: Open source community, VSCodium users
- **Requirements**: Eclipse account, Publisher agreement
- **Publishing Tool**: ovsx CLI
- **Review Time**: Instant

### 3. Alternative Distribution

- GitHub Releases (VSIX files)
- Private registries (NPM, Artifactory)
- Direct installation from VSIX

## Prerequisites

### Required Accounts

#### VS Code Marketplace

1. Create [Azure DevOps](https://dev.azure.com) account
2. Create organization if needed
3. Navigate to [Marketplace Publisher](https://marketplace.visualstudio.com/manage/createpublisher)
4. Create publisher with unique ID

#### Open VSX Registry

1. Create account at [open-vsx.org](https://open-vsx.org)
2. Sign [Publisher Agreement](https://open-vsx.org/about)
3. Link GitHub account (important!)

### Required Tools

```bash
# Install globally or as dev dependencies
npm install -g @vscode/vsce ovsx

# Or in project (already included)
npm install -D @vscode/vsce ovsx
```

## Initial Setup

### 1. Generate Personal Access Tokens

#### VS Code Marketplace PAT

1. Go to Azure DevOps: https://dev.azure.com/[your-org]
2. Click User Settings → Personal Access Tokens
3. Click "New Token"
4. Settings:
   - Name: `vscode-publishing`
   - Organization: Select your org
   - Expiration: 90 days (or custom)
   - Scopes: Click "Custom defined"
   - Select: `Marketplace → Manage`
5. Copy token immediately (shown once!)

#### Open VSX PAT

1. Go to: https://open-vsx.org/user-settings/tokens
2. Click "Generate New Token"
3. Give it a descriptive name: `github-actions-publish`
4. Copy token

### 2. Configure GitHub Secrets

Add these secrets to your GitHub repository:

```bash
# Using GitHub CLI
gh secret set VSCE_PAT        # VS Code Marketplace token
gh secret set OVSX_PAT        # Open VSX token

# Via GitHub Web
# Settings → Secrets and variables → Actions → New repository secret
```

### 3. Update package.json

Ensure these fields are properly set:

```json
{
  "name": "bergamot",
  "displayName": "Bergamot",
  "publisher": "your-publisher-id",
  "version": "0.1.0",
  "description": "Your description",
  "categories": ["Other"],
  "keywords": ["knowledge", "management", "browsing"],
  "engines": {
    "vscode": "^1.99.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/username/repo"
  },
  "license": "MIT",
  "icon": "icon.png",
  "galleryBanner": {
    "color": "#1e1e1e",
    "theme": "dark"
  }
}
```

## Build Process

### Development Build

```bash
cd vscode
npm run compile        # Compile TypeScript
npm run package       # Create VSIX package
```

### Production Build

```bash
cd vscode
npm run build:production  # Full production build with validation
```

This will:

- Clean previous builds
- Run linting
- Run tests
- Compile TypeScript
- Package as VSIX
- Validate package
- Generate metadata

### Version Management

```bash
# Bump version and update changelog
npm run version:patch      # 0.1.0 → 0.1.1
npm run version:minor      # 0.1.0 → 0.2.0
npm run version:major      # 0.1.0 → 1.0.0
npm run version:prerelease # 0.1.0 → 0.1.0-beta.1
```

## Publishing Workflow

### Automated Publishing (Recommended)

1. **Bump Version**:

   ```bash
   cd vscode
   npm run version:patch  # or minor/major
   ```

2. **Commit Changes**:

   ```bash
   git add -A
   git commit -m "chore(vscode): bump version to x.y.z"
   ```

3. **Create Tag**:

   ```bash
   git tag vscode-v0.1.1
   git push origin main --tags
   ```

4. **Automatic Publishing**:
   - GitHub Actions triggered on `vscode-v*` tags
   - Runs tests
   - Builds extension
   - Publishes to both marketplaces
   - Creates GitHub release

### Manual Triggering

Use GitHub Actions workflow dispatch:

1. Go to Actions tab
2. Select "VS Code Extension Build & Publish"
3. Click "Run workflow"
4. Choose publishing targets

## Manual Publishing

### To VS Code Marketplace

```bash
cd vscode

# Method 1: Build and publish
vsce publish

# Method 2: Publish existing VSIX
vsce publish --packagePath bergamot-0.1.0.vsix

# Method 3: With explicit token
VSCE_PAT=your-token npm run publish:vscode
```

### To Open VSX Registry

```bash
cd vscode

# First time: Create namespace
ovsx create-namespace your-publisher-id -p $OVSX_PAT

# Publish
ovsx publish -p $OVSX_PAT

# Or use npm script
OVSX_PAT=your-token npm run publish:openvsx
```

### Publish to Both

```bash
cd vscode
VSCE_PAT=token1 OVSX_PAT=token2 npm run publish:all
```

## Alternative Distribution

### GitHub Releases

VSIX files are automatically attached to releases when using the CI/CD pipeline.

### Direct Installation

Users can install VSIX directly:

```bash
# Download from GitHub releases
curl -L https://github.com/user/repo/releases/download/vscode-v0.1.0/bergamot-0.1.0.vsix -o extension.vsix

# Install
code --install-extension extension.vsix
```

### Private Registry

For corporate environments:

```bash
# Publish to private NPM registry
npm publish --registry https://your-registry.com

# Install from private registry
code --install-extension your-registry.com/bergamot
```

## Validation Checklist

Before publishing, ensure:

- [ ] Version bumped appropriately
- [ ] CHANGELOG.md updated
- [ ] Tests passing
- [ ] Linting clean
- [ ] README.md up-to-date
- [ ] Icon file present (128x128 or 256x256 PNG)
- [ ] Repository field valid
- [ ] License specified
- [ ] Categories appropriate
- [ ] Keywords relevant
- [ ] Display name clear
- [ ] Description compelling

## Marketplace Assets

### Icon Requirements

- Format: PNG (not SVG except for badges)
- Size: 128x128 or 256x256 pixels
- Background: Transparent or solid
- Location: `icon.png` in root

### README Requirements

- Must have `README.md`
- Include screenshots/GIFs
- Clear feature list
- Installation instructions
- Usage examples
- Requirements section

### Gallery Banner

```json
"galleryBanner": {
  "color": "#1e1e1e",
  "theme": "dark"
}
```

## Troubleshooting

### Common Issues

#### "Personal Access Token is invalid"

- Token may be expired
- Incorrect scopes selected
- Wrong organization in Azure DevOps

#### "Extension version already exists"

- Version not bumped
- Already published with this version
- Use `vsce publish --skip-duplicate`

#### "Missing publisher name"

- Add `"publisher": "your-id"` to package.json
- Ensure publisher exists in marketplace

#### "Cannot find module vsce"

- Run: `npm install -g @vscode/vsce`
- Or use: `npx vsce` instead

#### Open VSX: "Namespace does not exist"

- Run: `ovsx create-namespace your-publisher`
- Ensure you're logged in with correct account

### Validation Errors

#### Large Package Size

```bash
# Check what's included
npx vsce ls

# Add to .vscodeignore:
node_modules
*.map
.git
tests/
coverage/
```

#### Invalid README URLs

- Use HTTPS URLs only
- No relative paths for images
- Host images on GitHub or CDN

### Token Management

#### Rotating Tokens

1. Generate new token
2. Update GitHub secret
3. Delete old token
4. Test with a patch release

#### Token Permissions

VS Code Marketplace needs:

- Marketplace → Manage

Open VSX needs:

- Default token permissions

## Best Practices

1. **Semantic Versioning**: Follow major.minor.patch
2. **Changelog**: Keep detailed changelog
3. **Testing**: Always test before publishing
4. **Preview**: Use pre-release versions for testing
5. **Gradual Rollout**: Consider percentage rollout
6. **User Feedback**: Monitor reviews and issues
7. **Security**: Never commit tokens
8. **Automation**: Use CI/CD for consistency

## Support Resources

### Official Documentation

- [VS Code Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Open VSX Wiki](https://github.com/eclipse/openvsx/wiki)
- [vsce CLI](https://github.com/microsoft/vscode-vsce)
- [ovsx CLI](https://github.com/eclipse/openvsx/blob/master/cli/README.md)

### Marketplace Links

- [VS Code Marketplace](https://marketplace.visualstudio.com)
- [Open VSX Registry](https://open-vsx.org)
- [Publisher Management](https://marketplace.visualstudio.com/manage)

### Community

- [VS Code Discussions](https://github.com/microsoft/vscode/discussions)
- [Open VSX Issues](https://github.com/eclipse/openvsx/issues)

## Quick Commands Reference

```bash
# Version management
npm run version:patch
npm run version:minor
npm run version:major

# Building
npm run build:production
npm run package

# Publishing
npm run publish:vscode    # VS Code Marketplace
npm run publish:openvsx   # Open VSX
npm run publish:all       # Both

# Git workflow
git tag vscode-v0.1.0
git push origin main --tags
```
