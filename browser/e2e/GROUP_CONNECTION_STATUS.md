# Group Connection Status 🔗

## Current State: ❌ NOT IMPLEMENTED

The browser extension currently **does not send any group connection data** to the server for tabs opened from each other.

## What's Missing

### Data Currently NOT Sent
- ❌ `group_id` - No navigation group identifier
- ❌ `tab_id` - No tab identifier  
- ❌ `opener_tab_id` - No parent/opener tab relationship
- ❌ `session_id` - No session tracking

### Data Currently Sent
- ✅ `url` - Current page URL
- ✅ `referrer` - HTTP referrer (when available)
- ✅ `page_loaded_at` - Timestamp
- ✅ `content` - Compressed page content
- ✅ `referrer_timestamp` - When referrer was visited

## The Problem

When a user opens a new tab from an existing tab (e.g., Ctrl+Click, target="_blank", window.open), the visits are **not explicitly connected** in the server data.

### Example Scenario
1. User visits `github.com/repo`
2. User Ctrl+clicks on "Issues" link
3. New tab opens with `github.com/repo/issues`

### What Gets Sent
```json
// Visit 1
{
  "url": "github.com/repo",
  "referrer": "",
  "page_loaded_at": "2025-08-07T08:00:00Z",
  "content": "..."
}

// Visit 2 (new tab)
{
  "url": "github.com/repo/issues", 
  "referrer": "github.com/repo",  // Only connection!
  "page_loaded_at": "2025-08-07T08:00:05Z",
  "content": "..."
}
```

### What SHOULD Be Sent
```json
// Visit 1
{
  "url": "github.com/repo",
  "tab_id": "123",
  "group_id": "abc-def-789",  // Shared group
  "referrer": "",
  "page_loaded_at": "2025-08-07T08:00:00Z",
  "content": "..."
}

// Visit 2 (new tab)
{
  "url": "github.com/repo/issues",
  "tab_id": "456", 
  "opener_tab_id": "123",  // Explicit connection!
  "group_id": "abc-def-789",  // Same group!
  "referrer": "github.com/repo",
  "page_loaded_at": "2025-08-07T08:00:05Z",
  "content": "..."
}
```

## Why This Matters

Without explicit group connections:
1. **Lost Context**: Can't track which tabs belong to the same research session
2. **Broken Chains**: If referrer is missing (e.g., GitHub's no-referrer policy), tabs appear completely disconnected
3. **No Tree Structure**: Can't rebuild the tab tree showing parent-child relationships
4. **Poor Analytics**: Can't analyze navigation patterns within a session

## Where the Data Exists

The background script (`src/background.ts`) DOES track:
- `opener_tab_id` in `TabHistory` class
- Tab relationships via `handle_tab_opener()`

But this data is **never passed** to the content script or sent to the server!

## Test Coverage

The `pure_server_e2e_test.ts` now properly documents this limitation:
- Scenario 3 checks for tab relationships
- Explicitly notes missing fields: `group_id`, `tab_id`, `opener_tab_id`
- Test passes with referrer-only connection (current state)
- But logs what's missing for future implementation

## Recommended Fix

1. **Add fields to VisitData class**:
   ```typescript
   export class VisitData {
     constructor(
       public readonly url: string,
       public readonly page_loaded_at: string,
       public readonly referrer: string,
       public readonly content: string,
       public readonly referrer_timestamp?: number,
       // NEW FIELDS
       public readonly tab_id?: string,
       public readonly group_id?: string,
       public readonly opener_tab_id?: string
     ) {}
   }
   ```

2. **Pass tab info from background to content script**:
   - When content script requests referrer info
   - Include tab_id, group_id, opener_tab_id in response

3. **Generate consistent group_id**:
   - Use timestamp + random for root tabs
   - Inherit group_id from opener for child tabs

4. **Update tests** to require these fields

## Impact

This is a **critical missing feature** for proper navigation tracking and should be prioritized for implementation.