# Browser Extension Publishing Guide

This guide covers the complete process of publishing the PKM Navigation Tracker browser extension to various browser stores.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Store Account Setup](#store-account-setup)
- [API Credentials](#api-credentials)
- [Build Process](#build-process)
- [Publishing Workflow](#publishing-workflow)
- [Manual Publishing](#manual-publishing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

1. **Developer Accounts** on target platforms:
   - Chrome Web Store ($5 one-time fee)
   - Firefox Add-ons (free)
   - Edge Add-ons (free)
   - Opera Add-ons (free)

2. **Required Tools**:
   ```bash
   # Install dependencies
   cd browser
   npm install
   
   # Install global tools (optional, for manual publishing)
   npm install -g web-ext  # For Firefox
   ```

3. **Extension Assets**:
   - Icons (16x16, 48x48, 128x128 PNG)
   - Screenshots (1280x800 or 640x400)
   - Store descriptions (see `assets/store-listings/`)

## Store Account Setup

### Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay the one-time $5 developer fee
3. Complete account verification
4. Create a new item and note the Extension ID

### Firefox Add-ons

1. Create account at [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/)
2. No payment required
3. Complete email verification

### Edge Add-ons

1. Sign up at [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. Use existing Microsoft account or create new
3. Complete developer registration (free)
4. Create new extension submission and note Product ID

### Opera Add-ons

1. Register at [Opera Add-ons](https://addons.opera.com/developer/)
2. Verify email address
3. Can use Chrome extension package directly

## API Credentials

### Chrome Web Store

1. **Enable Chrome Web Store API**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create new project or select existing
   - Enable "Chrome Web Store API"

2. **Create OAuth2 Credentials**:
   - Go to APIs & Services > Credentials
   - Create OAuth 2.0 Client ID
   - Application type: Desktop app
   - Download credentials JSON

3. **Get Refresh Token**:
   ```bash
   # Use OAuth playground or custom script
   # Scopes needed: https://www.googleapis.com/auth/chromewebstore
   ```

4. **Set GitHub Secrets**:
   - `CHROME_CLIENT_ID`
   - `CHROME_CLIENT_SECRET`
   - `CHROME_REFRESH_TOKEN`
   - `CHROME_EXTENSION_ID`

### Firefox Add-ons

1. **Generate API Credentials**:
   - Go to [API Key Management](https://addons.mozilla.org/en-US/developers/addon/api/key/)
   - Generate new credentials
   - Save JWT issuer (API Key) and JWT secret

2. **Set GitHub Secrets**:
   - `FIREFOX_API_KEY` (JWT issuer)
   - `FIREFOX_API_SECRET` (JWT secret)

### Edge Add-ons

1. **Create Azure AD App**:
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to Azure Active Directory > App registrations
   - New registration with redirect URI
   - Note Application (client) ID

2. **Generate Client Secret**:
   - Go to Certificates & secrets
   - New client secret
   - Copy value immediately (shown once)

3. **Get Product ID**:
   - From Partner Center dashboard
   - Extension overview page

4. **Set GitHub Secrets**:
   - `EDGE_CLIENT_ID`
   - `EDGE_CLIENT_SECRET`
   - `EDGE_PRODUCT_ID`
   - `EDGE_ACCESS_TOKEN_URL` (optional)

## Build Process

### Development Build
```bash
npm run build          # Standard build
npm run build:test     # Build with test flags
```

### Production Build
```bash
npm run build:production  # Minified production build
# Creates:
# - builds/v{version}/chrome-extension.zip
# - builds/v{version}/firefox-extension.zip
# - builds/v{version}/edge-extension.zip
```

### Version Management
```bash
npm run version:patch   # 1.0.0 -> 1.0.1
npm run version:minor   # 1.0.0 -> 1.1.0
npm run version:major   # 1.0.0 -> 2.0.0
```

## Publishing Workflow

### Automated Publishing (GitHub Actions)

1. **Update Version**:
   ```bash
   npm run version:patch  # or minor/major
   ```

2. **Commit and Tag**:
   ```bash
   git add -A
   git commit -m "chore: bump version to x.y.z"
   git tag vx.y.z
   git push origin main --tags
   ```

3. **Automatic Deployment**:
   - GitHub Actions triggered on version tag
   - Runs tests
   - Builds extensions
   - Publishes to all stores
   - Creates GitHub release

### Manual Publishing

#### Chrome Web Store
```bash
# Build and publish
npm run build:production
npm run publish:chrome

# Or with specific file
node scripts/publish-chrome.js builds/v1.0.0/chrome-extension.zip
```

#### Firefox Add-ons
```bash
# Build and publish
npm run build:production
npm run publish:firefox

# Or using web-ext directly
web-ext sign \
  --source-dir=firefox \
  --api-key=$FIREFOX_API_KEY \
  --api-secret=$FIREFOX_API_SECRET
```

#### Edge Add-ons
```bash
# Build and publish
npm run build:production
npm run publish:edge

# Or with specific file
node scripts/publish-edge.js builds/v1.0.0/edge-extension.zip
```

## Manual Publishing

### Chrome Web Store (Manual)

1. Go to [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Select your extension
3. Click "Package" > "Upload new package"
4. Upload `chrome-extension.zip`
5. Update store listing if needed
6. Submit for review

### Firefox Add-ons (Manual)

1. Go to [Developer Hub](https://addons.mozilla.org/developers/)
2. Click "Submit a New Add-on"
3. Upload `firefox-extension.zip`
4. Choose distribution method (listed/unlisted)
5. Complete submission form
6. Submit for review

### Edge Add-ons (Manual)

1. Go to [Partner Center](https://partner.microsoft.com/dashboard)
2. Select your extension
3. Update > Packages
4. Upload `edge-extension.zip`
5. Update properties if needed
6. Submit for certification

### Opera Add-ons (Manual)

1. Go to [Opera Add-ons](https://addons.opera.com/developer/)
2. Upload new version
3. Use `chrome-extension.zip` (same format)
4. Update metadata
5. Submit for moderation

## Store Review Times

- **Chrome Web Store**: 1-3 business days
- **Firefox Add-ons**: 1-5 hours (automated + manual)
- **Edge Add-ons**: 1-7 business days
- **Opera Add-ons**: 1-14 days

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Clean and rebuild
rm -rf dist/ builds/
npm run build:production
```

#### Chrome Publishing Error
- Ensure OAuth token is fresh
- Check API quotas in Google Cloud Console
- Verify extension ID matches

#### Firefox Signing Error
- Check version number is incremented
- Ensure manifest is valid
- Verify API credentials are active

#### Edge Certification Failure
- Review certification report
- Common issues: permissions, security, performance
- Test in Edge before submission

### Validation Tools

```bash
# Validate manifest
npx web-ext lint --source-dir=firefox

# Test in browser
npm run chrome:debug
```

## Best Practices

1. **Version Control**:
   - Always tag releases
   - Keep CHANGELOG.md updated
   - Use semantic versioning

2. **Testing**:
   - Run full test suite before publishing
   - Test on multiple OS/browser combinations
   - Verify native messaging if applicable

3. **Store Listings**:
   - Keep descriptions updated
   - Add screenshots for new features
   - Respond to user reviews

4. **Security**:
   - Never commit API keys
   - Rotate credentials regularly
   - Use minimal permissions

5. **Release Notes**:
   - Clear, user-friendly descriptions
   - Highlight new features
   - Note breaking changes

## GitHub Secrets Configuration

Required secrets for automated publishing:

```yaml
# Chrome Web Store
CHROME_CLIENT_ID: 'your-client-id'
CHROME_CLIENT_SECRET: 'your-client-secret'
CHROME_REFRESH_TOKEN: 'your-refresh-token'
CHROME_EXTENSION_ID: 'your-extension-id'

# Firefox Add-ons
FIREFOX_API_KEY: 'your-jwt-issuer'
FIREFOX_API_SECRET: 'your-jwt-secret'

# Edge Add-ons
EDGE_CLIENT_ID: 'your-client-id'
EDGE_CLIENT_SECRET: 'your-client-secret'
EDGE_PRODUCT_ID: 'your-product-id'
EDGE_ACCESS_TOKEN_URL: 'your-token-url'  # Optional
```

## Support

- GitHub Issues: [Report problems](https://github.com/[your-username]/pkm-assistant/issues)
- Documentation: [Full docs](../README.md)
- Store Dashboards:
  - [Chrome](https://chrome.google.com/webstore/devconsole)
  - [Firefox](https://addons.mozilla.org/developers/)
  - [Edge](https://partner.microsoft.com/dashboard)
  - [Opera](https://addons.opera.com/developer/)