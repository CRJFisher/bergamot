# PKM Navigation Tracker Extension

A Firefox extension that tracks browsing navigation chains for personal knowledge management.

## Features

- **Enhanced Referrer Tracking**: Uses background script to maintain true navigation history per tab
- **Cross-Tab Support**: Tracks new tab creation from link clicks
- **Navigation Chain Tracking**: Maintains complete browsing sequences
- **Same-Page Filtering**: Ignores anchor links within the same page

## Installation & Testing

### 1. Build the Extension
```bash
npm run build
```

### 2. Load in Firefox for Testing

#### Method A: Firefox Developer Edition (Recommended)
1. Open Firefox Developer Edition
2. Go to `about:debugging`
3. Click "This Firefox" in the sidebar
4. Click "Load Temporary Add-on"
5. Navigate to this directory and select `manifest.json`

#### Method B: Regular Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` file

### 3. Test the Extension

1. **Open Browser Console** to see background script logs:
   - Press `F12` → Console tab
   - Or `about:debugging` → Inspect the extension

2. **Browse some websites** and check the logs:
   ```
   PKM Extension: Background script initialized
   PKM Extension: Installed and ready to track browsing chains
   ```

3. **Start your PKM server** (defaults to localhost:5000):
   ```bash
   # Example simple server
   python3 -m http.server 5000
   # Or your actual PKM backend
   ```

4. **Navigate between pages** and watch for POST requests to:
   - `/visit` - Page visits with referrer info
   - `/navigate` - Link click tracking

### 4. View Background Script Activity

Open the extension's background page console:
1. Go to `about:debugging`
2. Find your extension
3. Click "Inspect" next to the background script
4. Check the Console tab for logs

## API Endpoints

### POST /visit
```json
{
  "url": "https://example.com/page",
  "timestamp": 1749731880911,
  "referrer": "https://google.com/search",
  "referrerTimestamp": 1749731879911
}
```

### POST /navigate
```json
{
  "currentUrl": "https://example.com/page1", 
  "timestamp": 1749731880911,
  "targetUrl": "https://example.com/page2"
}
```

## Configuration

Set API endpoint via window object (for testing):
```javascript
window.PKM_CONFIG = { apiBaseUrl: 'http://localhost:3000' };
```

## Development

Run tests:
```bash
npm test
```

Build:
```bash
npm run build
``` 