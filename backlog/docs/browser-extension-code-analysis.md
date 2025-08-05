# Browser Extension Code Structure Analysis

## Current Code Architecture

### 1. Background Script (`background.ts`)

**Lines of Code**: 288
**Primary Responsibilities**:

- Tab history management
- Cross-tab navigation tracking
- Message routing between content scripts and PKM server
- SPA navigation handling

**Key Data Structures**:

- `TabHistory` interface: Tracks navigation state per tab
- `tabHistories` Map: Global storage for all tab histories

**Main Functions**:

- `chrome.tabs.onCreated`: Handles new tab creation
- `chrome.tabs.onUpdated`: Tracks URL changes
- `handleTabOpener()`: Manages referrer inheritance from opener tabs
- `chrome.runtime.onMessage`: Message hub for content scripts
- `sendToPKMServer()`: Forwards data to PKM backend

### 2. Content Script (`content.ts`)

**Lines of Code**: 392
**Primary Responsibilities**:

- Page content extraction and compression
- Visit data collection
- SPA navigation detection
- API communication coordination

**Key Features**:

- Dynamic port configuration for testing
- Zstandard compression for content
- Multiple SPA detection mechanisms
- Duplicate visit prevention

**Main Functions**:

- `send_visit_data()`: Initial page visit tracking
- `track_spa_navigation()`: Monitors history API and DOM changes
- `get_content()`: Extracts and compresses page body
- `get_true_referrer()`: Requests referrer from background script

### 3. URL Cleaning Module (`url_cleaning.ts`)

**Lines of Code**: 221
**Primary Responsibilities**:

- URL normalization
- Tracking parameter removal
- Navigation comparison utilities

**Key Features**:

- Comprehensive tracking parameter list (161 parameters)
- Fallback handling for malformed URLs
- Debug logging for URL transformations

## Areas of High Complexity

### 1. Tab History Management (background.ts)

**Issues**:

- Complex state management across multiple event handlers
- Duplicate logic between `onUpdated` and `handleTabUpdate()`
- Race conditions with opener tab information
- Mixed concerns: history tracking + message routing

**Refactoring Opportunities**:

- Extract TabHistoryManager class
- Separate message handling from history logic
- Implement state machine for tab lifecycle
- Add proper error boundaries

### 2. SPA Navigation Detection (content.ts)

**Issues**:

- Multiple overlapping detection mechanisms
- Repetitive code across history API overrides
- Complex visited URL tracking logic
- Tight coupling between detection and data sending

**Refactoring Opportunities**:

- Extract NavigationDetector class
- Unify navigation change handling
- Implement observer pattern for navigation events
- Separate detection from action handling

### 3. Configuration Management

**Issues**:

- Hardcoded values mixed with dynamic configuration
- Testing configuration bleeding into production code
- No centralized configuration management

**Refactoring Opportunities**:

- Create ConfigurationManager module
- Environment-based configuration loading
- Separate test and production configurations

## Proposed Module Structure

### Core Modules

1. **TabHistoryManager**
   - Manages tab navigation state
   - Handles tab lifecycle events
   - Provides history queries

2. **NavigationDetector**
   - Unified SPA detection
   - Navigation event emission
   - URL change debouncing

3. **MessageRouter**
   - Centralized message handling
   - Type-safe message definitions
   - Error handling and retries

4. **DataCollector**
   - Content extraction
   - Compression utilities
   - Visit data assembly

5. **APIClient**
   - Server communication
   - Request queuing
   - Offline support

### Navigation Type Modules

1. **StandardNavigation**
   - Regular page loads
   - Browser back/forward

2. **SPANavigation**
   - History API changes
   - DOM-based detection

3. **TabNavigation**
   - New tab creation
   - Cross-tab referrers

4. **LinkNavigation**
   - Click tracking
   - Target detection

## Code Quality Issues

### 1. Error Handling

- Minimal error boundaries
- Silent failures in critical paths
- No retry mechanisms

### 2. Type Safety

- Mixed use of any types
- Incomplete interface definitions
- No runtime type validation

### 3. Logging

- Excessive console.log statements
- No log levels or filtering
- Debug info in production

### 4. Testing

- No unit test coverage for core logic
- E2E tests limited by Playwright constraints
- No integration tests for message passing

## Refactoring Priority

1. **High Priority**:
   - Extract TabHistoryManager
   - Unify SPA navigation detection
   - Implement proper error handling

2. **Medium Priority**:
   - Create MessageRouter
   - Add configuration management
   - Improve type definitions

3. **Low Priority**:
   - Optimize logging system
   - Add performance monitoring
   - Implement offline support
