# VS Code Extension Publishing Secrets Setup

This guide helps you configure GitHub Secrets required for automated VS Code extension publishing.

## Required Secrets

### VS Code Marketplace

| Secret Name | Description                                   | How to Obtain                                         |
| ----------- | --------------------------------------------- | ----------------------------------------------------- |
| `VSCE_PAT`  | Personal Access Token for VS Code Marketplace | Azure DevOps → User Settings → Personal Access Tokens |

### Open VSX Registry

| Secret Name | Description                        | How to Obtain                                |
| ----------- | ---------------------------------- | -------------------------------------------- |
| `OVSX_PAT`  | Personal Access Token for Open VSX | open-vsx.org → User Settings → Access Tokens |

## Step-by-Step Setup

### VS Code Marketplace Token (VSCE_PAT)

#### 1. Create Azure DevOps Account

- Go to https://dev.azure.com
- Sign in with Microsoft account
- Create an organization if prompted

#### 2. Create Publisher

- Visit https://marketplace.visualstudio.com/manage/createpublisher
- Choose a unique publisher ID (e.g., `your-name`)
- Fill in display name and description
- Save the publisher ID - you'll need it in `package.json`

#### 3. Generate Personal Access Token

1. Go to https://dev.azure.com/[your-organization]
2. Click on User Settings (top right) → Personal Access Tokens
3. Click "+ New Token"
4. Configure token:
   ```
   Name: vscode-extension-publish
   Organization: [Your Organization]
   Expiration: 90 days (or custom)
   Scopes: Custom defined
   ```
5. Under Scopes, select:
   - Marketplace → Manage ✓
6. Click "Create"
7. **COPY THE TOKEN IMMEDIATELY** (shown only once!)

#### 4. Update package.json

```json
{
  "publisher": "your-publisher-id"
}
```

### Open VSX Registry Token (OVSX_PAT)

#### 1. Create Open VSX Account

1. Go to https://open-vsx.org
2. Click "Login" → "Login with GitHub" (recommended)
3. Authorize Open VSX

#### 2. Sign Publisher Agreement

1. Go to https://open-vsx.org/about
2. Read and accept the Eclipse Foundation Publisher Agreement
3. **Important**: Use the same GitHub account for consistency

#### 3. Generate Access Token

1. Click your avatar → Settings → Access Tokens
2. Click "Generate New Token"
3. Enter description: `github-actions-publish`
4. Click "Generate Token"
5. **COPY THE TOKEN** and save securely

## Adding Secrets to GitHub

### Method 1: GitHub Web Interface

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add each secret:
   - Name: `VSCE_PAT`
   - Value: [Your Azure DevOps token]
   - Click "Add secret"
5. Repeat for `OVSX_PAT`

### Method 2: GitHub CLI

```bash
# Install GitHub CLI if needed
brew install gh          # macOS
winget install gh        # Windows
sudo apt install gh      # Linux

# Authenticate
gh auth login

# Set secrets
gh secret set VSCE_PAT   # Paste token when prompted
gh secret set OVSX_PAT   # Paste token when prompted
```

### Method 3: Using Script

Create a temporary script `set-secrets.sh`:

```bash
#!/bin/bash
# DO NOT COMMIT THIS FILE!

echo "Setting VS Code publishing secrets..."

# VS Code Marketplace
echo "YOUR_VSCE_TOKEN_HERE" | gh secret set VSCE_PAT

# Open VSX
echo "YOUR_OVSX_TOKEN_HERE" | gh secret set OVSX_PAT

echo "✅ Secrets configured!"

# Delete this script after running!
rm set-secrets.sh
```

## Verifying Setup

### Test Workflow

Create `.github/workflows/test-vscode-secrets.yml`:

```yaml
name: Test VS Code Secrets
on: workflow_dispatch

jobs:
  test-secrets:
    runs-on: ubuntu-latest
    steps:
      - name: Check VSCE_PAT
        run: |
          if [ -n "${{ secrets.VSCE_PAT }}" ]; then
            echo "✅ VSCE_PAT is configured"
          else
            echo "❌ VSCE_PAT is missing"
            exit 1
          fi

      - name: Check OVSX_PAT
        run: |
          if [ -n "${{ secrets.OVSX_PAT }}" ]; then
            echo "✅ OVSX_PAT is configured"
          else
            echo "❌ OVSX_PAT is missing"
            exit 1
          fi
```

Run manually from Actions tab to verify.

## Token Permissions Reference

### Azure DevOps PAT Scopes

Required scope for publishing:

- ✅ Marketplace → Manage

Optional scopes (not needed):

- ❌ Marketplace → Acquire
- ❌ Marketplace → Publish

### Open VSX Token

- Default permissions are sufficient
- No special configuration needed

## Security Best Practices

### DO's ✅

- Rotate tokens every 90 days
- Use separate tokens for different environments
- Set minimal required permissions
- Use GitHub environments for production
- Enable 2FA on all accounts
- Audit token usage regularly

### DON'Ts ❌

- Never commit tokens to code
- Don't share tokens between projects
- Avoid tokens with unlimited expiration
- Don't use personal accounts for CI/CD
- Never log token values

## Token Rotation

### Rotating VSCE_PAT

1. Generate new token in Azure DevOps
2. Update GitHub secret: `gh secret set VSCE_PAT`
3. Test with a small version bump
4. Delete old token from Azure DevOps

### Rotating OVSX_PAT

1. Generate new token at open-vsx.org
2. Update GitHub secret: `gh secret set OVSX_PAT`
3. Test publishing
4. Delete old token from Open VSX

## Troubleshooting

### VSCE_PAT Issues

#### "Error: Personal Access Token verification failed"

- Token expired - generate new one
- Wrong organization selected
- Incorrect scopes - needs Marketplace → Manage

#### "Error: Failed to verify the Personal Access Token"

- Token copied incorrectly (extra spaces?)
- Using token from wrong organization

### OVSX_PAT Issues

#### "Error: Unauthorized"

- Token invalid or expired
- Account not verified
- Publisher agreement not signed

#### "Error: Namespace does not exist"

- Publisher ID mismatch
- Need to create namespace first:
  ```bash
  ovsx create-namespace [publisher-id] -p [token]
  ```

### GitHub Secrets Issues

#### Secrets not available in workflow

- Check secret names match exactly (case-sensitive)
- Verify workflow has permission to access secrets
- For forked repos: Secrets not available to fork PRs

#### "Error: Missing required environment variable"

- Secret not set in GitHub
- Typo in secret name
- Using wrong environment

## Local Development

For local testing, create `.env.local` (NEVER commit!):

```bash
# .env.local
VSCE_PAT=your-vsce-token
OVSX_PAT=your-ovsx-token
```

Use in scripts:

```bash
# Load environment
source .env.local

# Test publishing locally
npm run publish:vscode
npm run publish:openvsx
```

Add to `.gitignore`:

```
.env.local
.env*.local
```

## Environment-Specific Tokens

For different environments:

### GitHub Environments Setup

1. Go to Settings → Environments
2. Create: `development`, `staging`, `production`
3. Add environment-specific secrets
4. Configure protection rules

### Workflow Usage

```yaml
jobs:
  publish:
    environment: production # Uses production secrets
    steps:
      - name: Publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

## Quick Reference

### Commands

```bash
# Check if secrets are set (GitHub CLI)
gh secret list

# Set/update secret
gh secret set VSCE_PAT
gh secret set OVSX_PAT

# Delete secret
gh secret delete VSCE_PAT
```

### URLs

- **Azure DevOps**: https://dev.azure.com
- **VS Code Publisher**: https://marketplace.visualstudio.com/manage
- **Open VSX**: https://open-vsx.org
- **Open VSX Tokens**: https://open-vsx.org/user-settings/tokens

### Required Fields in package.json

```json
{
  "name": "extension-name",
  "displayName": "Extension Display Name",
  "publisher": "your-publisher-id",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.99.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/user/repo"
  },
  "license": "MIT"
}
```

## Support

### Documentation

- [VS Code Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Azure DevOps PAT](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
- [Open VSX Publishing](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)

### Help

- VS Code: https://github.com/microsoft/vscode/discussions
- Open VSX: https://github.com/eclipse/openvsx/issues
- Azure DevOps: https://developercommunity.visualstudio.com
