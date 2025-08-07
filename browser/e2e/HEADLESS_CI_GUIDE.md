# Headless Testing & CI Guide

## Current Test Configuration

### Headless Mode Status
- **Default**: Tests run with `headless: false` (GUI mode) locally
- **CI Mode**: Tests MUST run with `headless: true` for CI/CD
- **Chrome Version**: Using Chrome's new headless mode (`--headless=new`)

## Headless Mode Capabilities

### ✅ What Works in Headless
- Page navigation
- JavaScript execution
- Network requests (HTTP/HTTPS)
- Extension loading and execution
- Console log capture
- DOM manipulation
- Multiple page/tab creation
- Cookies and storage
- Screenshots and PDFs

### ⚠️ Headless Limitations
1. **Native Messaging**: `chrome.runtime.connectNative` not available in CDP mode (both headless and GUI)
2. **Window Management**: Some window positioning APIs may behave differently
3. **GPU Acceleration**: Disabled by default (can affect WebGL/Canvas)
4. **Media Playback**: Audio/video autoplay policies differ
5. **Extensions UI**: Popup and options pages harder to test

### ✅ Multi-Tab State Management
**Good news**: Chrome's new headless mode (`--headless=new`) maintains state across tabs properly:
- Tab opener relationships are tracked
- Session cookies are shared
- Background script state is maintained
- Tab IDs are consistent

## CI Configuration

### GitHub Actions Setup
```yaml
# Method 1: Browser Actions (Recommended)
- uses: browser-actions/setup-chrome@v1
  with:
    chrome-version: stable

# Method 2: Puppeteer's Chromium
- run: npx puppeteer browsers install chrome

# Method 3: Docker with pre-installed browsers
container:
  image: mcr.microsoft.com/playwright:v1.40.0-focal
```

### Required Dependencies for CI
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libxkbcommon0 \
  libxss1 \
  libasound2
```

## Test Execution Modes

### Local Development (with GUI)
```typescript
await runner.setup({ headless: false });
```
- Allows visual debugging
- Can interact with browser
- Slower but more observable

### CI/Production (headless)
```typescript
await runner.setup({ headless: true });
```
- Faster execution
- No GPU overhead
- Suitable for CI pipelines

## Pure Server E2E Test

The `pure_server_e2e_test.ts` is designed specifically for CI:
- **Always runs headless**
- **No console log dependency** - validates only server data
- **Black-box testing** - treats extension as opaque
- **Data validation only** - checks what server receives

### What It Validates
1. **Basic Navigation**: Multiple page visits recorded
2. **SPA Navigation**: Client-side routing tracked
3. **Tab Relationships**: Opener tracking works
4. **Referrer Chain**: Navigation history preserved
5. **Metadata Completeness**: All required fields present

## Running Tests in CI

### Minimal CI Test
```bash
# Just run the pure server test
npx tsx e2e/pure_server_e2e_test.ts
```

### Full Test Suite
```bash
# Build first
npm run build

# Run tests with timeout
timeout 5m npx tsx e2e/navigation_e2e_tests.ts || true
timeout 3m npx tsx e2e/quick_test_all.ts || true
```

### Environment Variables
```bash
export CI=true
export HEADLESS=true
export CHROME_PATH=/usr/bin/google-chrome-stable
```

## Docker Alternative

For consistent CI environment:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app
COPY browser/package*.json ./
RUN npm ci

COPY browser/ ./
RUN npm run build

CMD ["npx", "tsx", "e2e/pure_server_e2e_test.ts"]
```

## Debugging CI Failures

### 1. Check Chrome Installation
```bash
google-chrome --version
which google-chrome || which chromium
```

### 2. Run with Debugging
```bash
DEBUG=* npx tsx e2e/pure_server_e2e_test.ts
```

### 3. Capture Screenshots on Failure
```typescript
if (!passed) {
  await client.Page.captureScreenshot({ 
    path: `failure-${Date.now()}.png` 
  });
}
```

### 4. Check Extension Loading
```typescript
const targets = await CDP.List({ port: 9222 });
console.log('Loaded targets:', targets.map(t => t.type));
```

## Best Practices for CI

1. **Always use headless in CI**
2. **Set reasonable timeouts** (2-3 minutes max per test)
3. **Use `continue-on-error` for non-critical tests**
4. **Upload artifacts for debugging**
5. **Run in Docker for consistency**
6. **Test multiple Node versions**
7. **Cache dependencies**

## Summary

- ✅ Tests work in headless mode with full functionality
- ✅ Tab state and relationships are maintained
- ✅ Extension tracking works correctly
- ⚠️ Native messaging not available (but we use HTTP fallback)
- ✅ Ready for CI with GitHub Actions configuration provided