---
id: task-16
title: Handle out-of-order page visits in navigation tree building
status: To Do
assignee: []
created_date: "2025-08-07 08:57"
labels:
  - vscode
  - navigation
  - critical
dependencies: []
---

## Description

When tabs are opened via links or window.open(), the child tab often sends its visit BEFORE the parent tab. This creates orphaned pages that arrive at the server with an opener_tab_id that doesn't exist yet. The VS Code extension needs to handle this race condition when building navigation trees.

### Why This Happens - The Two-Phase Process

The browser extension has a critical two-phase process that causes out-of-order visits:

1. **Tab metadata assignment (IMMEDIATE)** - When a tab is created, the background script instantly assigns:

   - `group_id` (generated for root tabs, inherited for child tabs)
   - `tab_id` (unique identifier)
   - `opener_tab_id` (if opened from another tab)

2. **Visit data sending (DELAYED)** - Content scripts run at `document_end` and send visit data:
   - Timing depends on page complexity, resources, network speed
   - Simpler pages reach `document_end` faster
   - Child pages are often simpler/faster than parent pages

### Example Timeline

```
Time →
│
├─ T+0ms:   User navigates to GitHub repo page (complex, many resources)
├─ T+1ms:   Background assigns group_id=abc123 to tab 123
├─ T+50ms:  GitHub page still loading resources...
├─ T+100ms: User Ctrl+clicks "Issues" link
├─ T+101ms: Background assigns group_id=abc123 to tab 456 (inherited from opener)
├─ T+150ms: Issues page reaches document_end → sends visit with opener_tab_id=123 ✉️
├─ T+300ms: Repo page finally reaches document_end → sends visit for tab_id=123 ✉️
│
└─ VS Code receives: Child (tab 456) BEFORE parent (tab 123)!
```

### The Problem for VS Code

When the Issues page visit arrives first:

- It has `opener_tab_id=123` but tab 123 doesn't exist in the database yet
- The visit appears "orphaned" even though it has correct group tracking data
- When the parent arrives later, the tree structure needs to be reconstructed

### Why We Can't Prevent This

- **Can't send visits earlier**: Need `document_end` to capture page content/title
- **Can't guarantee order**: Network latency and page load times vary
- **Background script can't help**: No access to page DOM content
- **Group tracking is correct**: The issue is only visit arrival order, not the data itself

## Acceptance Criteria

- [ ] VS Code extension temporarily stores orphaned pages (visits with unmatched opener_tab_id)
- [ ] When parent page arrives later check for orphaned children and reconnect them
- [ ] Update or re-insert child pages to maintain proper tree structure
- [ ] Reconcile group_id if parent and child have different group_ids
- [ ] Navigation trees correctly reflect parent-child relationships regardless of arrival order
- [ ] Add tests for out-of-order page visit scenarios

## Implementation Approach

### 1. Orphan Queue System

Create a temporary storage for visits that reference non-existent opener_tab_ids:

```typescript
interface OrphanedVisit {
  visit_data: PageVisit;
  opener_tab_id: string;
  arrival_time: Date;
}

const orphan_queue = new Map<string, OrphanedVisit[]>();
```

### 2. Visit Processing Logic

When a visit arrives:

1. Check if `opener_tab_id` exists in database
2. If yes: Insert normally with parent relationship
3. If no: Add to orphan queue keyed by `opener_tab_id`
4. Check if this visit's `tab_id` has orphans waiting for it
5. If yes: Process and insert orphans with correct relationships

### 3. Tree Reconciliation

When connecting orphaned visits:

- Verify `group_id` matches (should already from browser extension)
- Update tree structure to reflect proper parent-child relationships
- Maintain insertion order for accurate timeline

### 4. Cleanup Strategy

- Set TTL on orphaned visits (e.g., 30 seconds)
- Log warnings for permanently orphaned visits
- Consider visits without `opener_tab_id` as root nodes

## Testing Scenarios

1. **Fast child, slow parent**: Child page loads before parent
2. **Multiple children**: Parent opens several tabs in quick succession
3. **Deep nesting**: Parent → Child → Grandchild with various load speeds
4. **Network delays**: Simulate delayed HTTP requests to server
5. **Missing parent**: Orphaned visit where parent never arrives (closed tab)
