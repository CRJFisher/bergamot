# Browser Extension API Reference

This document provides a complete API reference for all modules in the PKM browser extension.

## Core Modules

### tab_history_manager

Module for managing tab navigation history with immutable operations.

#### Functions

##### `create_tab_history(url?: string, opener_tab_id?: number, previous_history?: TabHistory): TabHistory`
Creates a new tab history entry.

**Parameters:**
- `url`: Current URL (optional)
- `opener_tab_id`: ID of tab that opened this tab (optional)
- `previous_history`: Previous history to build upon (optional)

**Returns:** New `TabHistory` object

##### `update_tab_history(store: TabHistoryStore, tab_id: number, new_url: string): TabHistoryStore`
Updates history for a specific tab.

**Parameters:**
- `store`: Current history store
- `tab_id`: Tab to update
- `new_url`: New URL to add to history

**Returns:** New `TabHistoryStore` with updated history

##### `get_tab_history(store: TabHistoryStore, tab_id: number): TabHistory | undefined`
Retrieves history for a specific tab.

##### `cleanup_tab_history(store: TabHistoryStore, tab_id: number): TabHistoryStore`
Removes history for a closed tab.

##### `transfer_opener_info(store: TabHistoryStore, from_tab_id: number, to_tab_id: number): TabHistoryStore`
Transfers opener information between tabs.

---

### navigation_detector

Module for detecting and handling SPA navigation events.

#### Functions

##### `create_navigation_state(initial_url?: string): NavigationState`
Creates initial navigation tracking state.

##### `has_been_visited(state: NavigationState, url: string): boolean`
Checks if a URL has been visited in this session.

##### `mark_as_visited(state: NavigationState, url: string): NavigationState`
Marks a URL as visited.

##### `should_handle_navigation(state: NavigationState, new_url: string, source: string): { should_handle: boolean; new_state: NavigationState }`
Determines if navigation should be processed.

##### `create_push_state_handler(get_state: () => NavigationState, update_state: (state: NavigationState) => void, callback: (url: string) => void): Function`
Creates handler for history.pushState events.

##### `create_replace_state_handler(...): Function`
Creates handler for history.replaceState events.

##### `create_popstate_handler(...): Function`
Creates handler for popstate events.

---

### data_collector

Module for collecting and compressing page data.

#### Functions

##### `uint8_array_to_base64(uint8Array: Uint8Array): string`
Converts binary data to base64 string.

##### `compress_content(content: string, zstd: any): Promise<string>`
Compresses content using zstd algorithm.

##### `extract_page_content(): string`
Extracts HTML content from current page.

##### `create_visit_data(url: string, referrer: string, referrer_timestamp: number | undefined, zstd: any): Promise<VisitData>`
Creates complete visit data object with compressed content.

##### `create_zstd_instance(): Promise<any>`
Creates and initializes zstd compression instance.

---

### message_router

Module for handling inter-component messaging.

#### Functions

##### `handle_get_referrer(request: any, sender: chrome.runtime.MessageSender, tab_history_store: TabHistoryStore): any`
Handles requests for referrer information.

**Returns:**
```typescript
{
  referrer: string,
  referrer_timestamp?: number
}
```

##### `handle_spa_navigation(request: any, sender: chrome.runtime.MessageSender, tab_history_store: TabHistoryStore): TabHistoryStore`
Handles SPA navigation notifications.

##### `handle_server_request(request: any, send_to_server: Function): Promise<void>`
Forwards requests to PKM server.

##### `create_message_handler(tab_history_store: TabHistoryStore, update_store: Function, send_to_server: Function): Function`
Creates unified message handler for all message types.

---

### configuration_manager

Module for managing extension configuration.

#### Functions

##### `get_default_config(): ServerConfig`
Returns default server configuration.

##### `get_server_config(): Promise<ServerConfig>`
Retrieves current server configuration from storage.

##### `update_server_config(config: Partial<ServerConfig>): Promise<void>`
Updates server configuration in storage.

---

### api_client

Module for HTTP communication with PKM server.

#### Functions

##### `send_to_server(base_url: string, endpoint: string, data: any): Promise<void>`
Sends data to server endpoint.

**Parameters:**
- `base_url`: Server base URL (e.g., "http://localhost:5000")
- `endpoint`: API endpoint (e.g., "/visit")
- `data`: Data to send (will be JSON stringified)

**Throws:** Error if request fails

---

## Utility Modules

### url_cleaning

Module for normalizing URLs by removing tracking parameters.

#### Constants

##### `tracking_parameters: Set<string>`
Set of parameter names that should be removed from URLs.

Includes parameters from:
- Google Analytics (utm_*, gclid, etc.)
- Facebook (fbclid, fb_*)
- Microsoft (msclkid, mc_*)
- Twitter (twclid)
- TikTok (ttclid)
- And many more...

#### Functions

##### `normalize_url_for_navigation(url: string): string`
Normalizes URL by removing all tracking parameters.

**Parameters:**
- `url`: URL to normalize

**Returns:** Normalized URL without tracking parameters

---

## Type Definitions

### TabHistory
```typescript
class TabHistory {
  previous_url?: string
  current_url?: string
  timestamp: number
  previous_url_timestamp?: number
  opener_tab_id?: number
}
```

### TabHistoryStore
```typescript
type TabHistoryStore = Map<number, TabHistory>
```

### NavigationState
```typescript
class NavigationState {
  current_path: string
  visited_urls: Set<string>
  last_known_url: string
}
```

### VisitData
```typescript
class VisitData {
  url: string
  referrer: string
  referrer_timestamp?: number
  content: string
  page_loaded_at: string
}
```

### ServerConfig
```typescript
class ServerConfig {
  base_url: string
  endpoints: {
    visit: string
  }
}
```

---

## Message Protocol

### getReferrerInfo
Request referrer information for current tab.

**Request:**
```typescript
{ type: "getReferrerInfo" }
```

**Response:**
```typescript
{
  referrer: string,           // Previous URL or empty string
  referrer_timestamp?: number // When referrer was visited
}
```

### spaNavigation
Notify background script of SPA navigation.

**Request:**
```typescript
{
  type: "spaNavigation",
  url: string  // New URL after navigation
}
```

### forwardToServer
Forward data to PKM server.

**Request:**
```typescript
{
  type: "forwardToServer",
  endpoint: string,  // Server endpoint (e.g., "/visit")
  data: any         // Data to send
}
```