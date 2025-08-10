# GitHub Secrets Setup Guide

This guide helps you configure GitHub Secrets required for automated browser extension publishing.

## Required Secrets

### Chrome Web Store Secrets

| Secret Name | Description | How to Obtain |
|------------|-------------|---------------|
| `CHROME_CLIENT_ID` | OAuth2 Client ID | Google Cloud Console > APIs & Services > Credentials |
| `CHROME_CLIENT_SECRET` | OAuth2 Client Secret | Same as above, from OAuth2 credentials |
| `CHROME_REFRESH_TOKEN` | OAuth2 Refresh Token | Use OAuth2 playground or script below |
| `CHROME_EXTENSION_ID` | Extension ID | Chrome Web Store Developer Dashboard |

### Firefox Add-ons Secrets

| Secret Name | Description | How to Obtain |
|------------|-------------|---------------|
| `FIREFOX_API_KEY` | JWT Issuer | addons.mozilla.org > Tools > Manage API Keys |
| `FIREFOX_API_SECRET` | JWT Secret | Same page, generated with API key |

### Edge Add-ons Secrets

| Secret Name | Description | How to Obtain |
|------------|-------------|---------------|
| `EDGE_CLIENT_ID` | Azure AD App ID | Azure Portal > App registrations |
| `EDGE_CLIENT_SECRET` | Azure AD Secret | Azure Portal > Certificates & secrets |
| `EDGE_PRODUCT_ID` | Extension Product ID | Partner Center > Extension overview |
| `EDGE_ACCESS_TOKEN_URL` | Token endpoint (optional) | Usually default value works |

## Setting Secrets in GitHub

### Via GitHub Web Interface

1. Navigate to your repository
2. Go to Settings > Secrets and variables > Actions
3. Click "New repository secret"
4. Add each secret with name and value
5. Click "Add secret"

### Via GitHub CLI

```bash
# Install GitHub CLI if needed
# brew install gh  # macOS
# sudo apt install gh  # Ubuntu

# Authenticate
gh auth login

# Set secrets
gh secret set CHROME_CLIENT_ID
gh secret set CHROME_CLIENT_SECRET
gh secret set CHROME_REFRESH_TOKEN
gh secret set CHROME_EXTENSION_ID

gh secret set FIREFOX_API_KEY
gh secret set FIREFOX_API_SECRET

gh secret set EDGE_CLIENT_ID
gh secret set EDGE_CLIENT_SECRET
gh secret set EDGE_PRODUCT_ID
```

## Getting Chrome OAuth2 Refresh Token

### Method 1: OAuth2 Playground

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click settings (gear icon)
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. In Step 1, find and select:
   - `https://www.googleapis.com/auth/chromewebstore`
6. Click "Authorize APIs"
7. Grant permissions
8. Click "Exchange authorization code for tokens"
9. Copy the Refresh Token

### Method 2: Script

Create a file `get-chrome-token.js`:

```javascript
const { OAuth2Client } = require('google-auth-library');
const http = require('http');
const url = require('url');
const open = require('open');

const client = new OAuth2Client(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'http://localhost:3000/oauth2callback'
);

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/chromewebstore'],
});

const server = http.createServer(async (req, res) => {
  if (req.url.indexOf('/oauth2callback') > -1) {
    const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
    const code = qs.get('code');
    
    const { tokens } = await client.getToken(code);
    console.log('Refresh Token:', tokens.refresh_token);
    
    res.end('Authentication successful! Check console for token.');
    server.close();
  }
});

server.listen(3000, () => {
  console.log('Opening browser for authentication...');
  open(authUrl);
});
```

## Getting Edge/Azure AD Credentials

1. **Register App in Azure**:
   ```bash
   # Using Azure CLI
   az ad app create --display-name "PKM Extension Publisher"
   
   # Note the appId (CLIENT_ID)
   ```

2. **Create Client Secret**:
   ```bash
   az ad app credential reset --id <APP_ID>
   # Note the password (CLIENT_SECRET)
   ```

3. **Get Product ID**:
   - Log into [Partner Center](https://partner.microsoft.com/dashboard)
   - Navigate to your extension
   - Copy Product ID from overview

## Security Best Practices

### Do's
- ✅ Use GitHub's encrypted secrets
- ✅ Rotate credentials periodically
- ✅ Use separate credentials for dev/prod
- ✅ Enable 2FA on all accounts
- ✅ Audit secret access regularly

### Don'ts
- ❌ Never commit secrets to code
- ❌ Don't share credentials
- ❌ Avoid storing secrets locally
- ❌ Don't use personal accounts for automation
- ❌ Never log secret values in workflows

## Testing Secrets

### Verify Secrets Are Set

```yaml
# .github/workflows/test-secrets.yml
name: Test Secrets
on: workflow_dispatch

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Check Chrome Secrets
        run: |
          if [ -n "${{ secrets.CHROME_CLIENT_ID }}" ]; then
            echo "✅ CHROME_CLIENT_ID is set"
          else
            echo "❌ CHROME_CLIENT_ID is missing"
          fi
          
      - name: Check Firefox Secrets
        run: |
          if [ -n "${{ secrets.FIREFOX_API_KEY }}" ]; then
            echo "✅ FIREFOX_API_KEY is set"
          else
            echo "❌ FIREFOX_API_KEY is missing"
          fi
          
      - name: Check Edge Secrets
        run: |
          if [ -n "${{ secrets.EDGE_CLIENT_ID }}" ]; then
            echo "✅ EDGE_CLIENT_ID is set"
          else
            echo "❌ EDGE_CLIENT_ID is missing"
          fi
```

## Environment-Specific Secrets

For different environments (dev, staging, prod):

### Using Environments

1. Go to Settings > Environments
2. Create environments: `development`, `staging`, `production`
3. Add environment-specific secrets
4. Update workflow:

```yaml
jobs:
  publish:
    environment: production
    # Uses production-specific secrets
```

### Naming Convention

```
# Development
DEV_CHROME_CLIENT_ID
DEV_FIREFOX_API_KEY

# Production
PROD_CHROME_CLIENT_ID
PROD_FIREFOX_API_KEY
```

## Troubleshooting

### Secret Not Available in Workflow

1. Check secret name matches exactly (case-sensitive)
2. Verify workflow has permission to access secrets
3. For forked repos, secrets aren't available to PRs

### Authentication Failures

1. Chrome: Refresh token may expire after 6 months
2. Firefox: API keys don't expire but can be revoked
3. Edge: Check Azure AD app permissions

### Rate Limiting

- Chrome Web Store API: 200 requests per day
- Firefox: No strict limits
- Edge: Standard Azure AD limits apply

## Local Development

For local testing, use `.env` file (never commit!):

```bash
# .env.local
CHROME_CLIENT_ID=your-id
CHROME_CLIENT_SECRET=your-secret
CHROME_REFRESH_TOKEN=your-token
CHROME_EXTENSION_ID=your-extension-id

FIREFOX_API_KEY=your-key
FIREFOX_API_SECRET=your-secret

EDGE_CLIENT_ID=your-id
EDGE_CLIENT_SECRET=your-secret
EDGE_PRODUCT_ID=your-product-id
```

Load in scripts:
```javascript
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
```

## Support

- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using_webstore_api/)
- [Firefox Add-ons API](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
- [Edge Add-ons API](https://docs.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api)