# Browser Extension Functionality Overview

This document provides a comprehensive overview of the PKM referrer tracker browser extension functionality with links to the implementing modules.

## Architecture Overview

The extension follows a functional programming paradigm with immutable data structures and pure functions. It consists of:

- **Background Script** (`src/background.ts`): Manages tab lifecycle and history tracking
- **Content Script** (`src/content.ts`): Detects navigation and collects page data
- **Core Modules** (`src/core/`): Functional modules for specific features
- **Utility Modules** (`src/utils/`): Helper functions and utilities
- **Type Definitions** (`src/types/`): TypeScript interfaces and data classes

## Core Functionality

### 1. Tab History Management

**Purpose**: Tracks navigation history for each browser tab, including referrer information and tab relationships.

**Module**: [`src/core/tab_history_manager.ts`](../../referrer_tracker_extension/src/core/tab_history_manager.ts)

**Key Functions**:
- `create_tab_history()`: Creates new tab history entries
- `update_tab_history()`: Updates existing tab history
- `get_tab_history()`: Retrieves history for a specific tab
- `cleanup_tab_history()`: Removes history for closed tabs

**Data Structure**:
```typescript
class TabHistory {
  previous_url?: string
  current_url?: string
  timestamp: number
  previous_url_timestamp?: number
  opener_tab_id?: number
}
```

### 2. Navigation Detection

**Purpose**: Detects and tracks SPA navigation events using history API monitoring.

**Module**: [`src/core/navigation_detector.ts`](../../referrer_tracker_extension/src/core/navigation_detector.ts)

**Key Functions**:
- `create_navigation_state()`: Initializes navigation tracking state
- `should_handle_navigation()`: Determines if navigation should be processed
- `create_push_state_handler()`: Factory for pushState event handler
- `create_replace_state_handler()`: Factory for replaceState event handler
- `create_popstate_handler()`: Factory for popstate event handler

**Features**:
- Ignores duplicate navigations to same URL
- Tracks visited URLs to avoid duplicate processing
- Normalizes URLs by removing tracking parameters

### 3. Data Collection

**Purpose**: Collects page content and compresses it for storage.

**Module**: [`src/core/data_collector.ts`](../../referrer_tracker_extension/src/core/data_collector.ts)

**Key Functions**:
- `extract_page_content()`: Extracts HTML from current page
- `compress_content()`: Compresses content using zstd
- `create_visit_data()`: Creates complete visit data object
- `uint8_array_to_base64()`: Converts compressed data to base64

**Data Structure**:
```typescript
class VisitData {
  url: string
  referrer: string
  referrer_timestamp?: number
  content: string
  page_loaded_at: string
}
```

### 4. Message Routing

**Purpose**: Handles communication between content scripts, background script, and external services.

**Module**: [`src/core/message_router.ts`](../../referrer_tracker_extension/src/core/message_router.ts)

**Key Functions**:
- `handle_get_referrer()`: Provides referrer information for tabs
- `handle_spa_navigation()`: Processes SPA navigation events
- `handle_server_request()`: Forwards data to PKM server
- `create_message_handler()`: Creates unified message handler

**Message Types**:
- `getReferrerInfo`: Request referrer data for current tab
- `spaNavigation`: Notify of SPA navigation event
- `forwardToServer`: Send data to PKM server

### 5. Configuration Management

**Purpose**: Manages extension configuration and server settings.

**Module**: [`src/core/configuration_manager.ts`](../../referrer_tracker_extension/src/core/configuration_manager.ts)

**Key Functions**:
- `get_server_config()`: Retrieves server configuration
- `update_server_config()`: Updates configuration settings
- `get_default_config()`: Provides default configuration

**Configuration Structure**:
```typescript
class ServerConfig {
  base_url: string = "http://localhost:5000"
  endpoints: {
    visit: string = "/visit"
  }
}
```

### 6. API Client

**Purpose**: Handles HTTP communication with the PKM server.

**Module**: [`src/core/api_client.ts`](../../referrer_tracker_extension/src/core/api_client.ts)

**Key Functions**:
- `send_to_server()`: Sends data to server endpoint

**Features**:
- POST requests with JSON payloads
- Error handling and logging
- Configurable base URL and endpoints

### 7. URL Cleaning

**Purpose**: Removes tracking parameters from URLs for cleaner navigation detection.

**Module**: [`src/utils/url_cleaning.ts`](../../referrer_tracker_extension/src/utils/url_cleaning.ts)

**Key Functions**:
- `normalize_url_for_navigation()`: Normalizes URLs by removing tracking params

**Tracked Parameters**:
- Google Analytics: `utm_*`, `gclid`, etc.
- Facebook: `fbclid`, `fb_*`
- Microsoft: `msclkid`, `mc_*`
- And many more...

## Data Flow

1. **Page Load/Navigation**:
   - Content script detects navigation via history API or page load
   - Extracts and compresses page content
   - Requests referrer info from background script

2. **Background Processing**:
   - Background script maintains tab history across all tabs
   - Provides referrer information based on tab history
   - Handles tab lifecycle events (create, update, close)

3. **Data Transmission**:
   - Content script sends visit data to PKM server
   - Includes URL, referrer, timestamp, and compressed content

## Testing

The extension includes comprehensive unit tests for all modules:

- **Unit Tests**: `tests/*.test.ts` - Jest-based tests with jsdom
- **E2E Tests**: `e2e/cdp_*.ts` - Chrome DevTools Protocol tests
- **Coverage**: 89.37% overall test coverage

## Building and Development

- **Build**: `npm run build` - Bundles TypeScript to JavaScript
- **Test**: `npm run test:unit` - Runs unit tests
- **E2E Test**: `npm run test:cdp` - Runs CDP integration tests

## API Reference

### Background Script API

```typescript
// Tab history management
get_tab_history(tab_id: number): TabHistory | undefined
update_tab_history(tab_id: number, new_url: string): void

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse))
```

### Content Script API

```typescript
// Navigation detection
monitor_navigation(callback: (url: string) => void): void

// Data collection
collect_and_send_visit_data(): Promise<void>
```

### Message Protocol

```typescript
// Get referrer info
{ type: "getReferrerInfo" }
// Response: { 
//   referrer: string, 
//   referrer_timestamp?: number 
// }

// SPA navigation
{ 
  type: "spaNavigation", 
  url: string 
}

// Forward to server
{ 
  type: "forwardToServer", 
  endpoint: string, 
  data: any 
}
```