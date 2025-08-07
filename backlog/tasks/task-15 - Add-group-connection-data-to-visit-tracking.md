---
id: task-15
title: Add group connection data to visit tracking
status: Done
assignee: []
created_date: '2025-08-07 08:45'
updated_date: '2025-08-07 08:58'
labels:
  - browser
  - navigation
  - critical
dependencies: []
---

## Description

The browser extension currently doesn't send group connection data (group_id, tab_id, opener_tab_id) to the server, making it impossible to track which tabs belong to the same navigation session. Tabs opened from each other only connect via the unreliable referrer field.

## Acceptance Criteria

- [x] Extension sends group_id with every visit to group related navigation sessions
- [x] Extension sends tab_id to identify individual tabs
- [x] Extension sends opener_tab_id to track parent-child tab relationships
- [x] Tabs opened from same origin share the same group_id
- [x] Group connections work even when referrer is missing (e.g. GitHub)
- [x] E2E tests validate group connection data is sent correctly

## Implementation Plan

1. Analyze current data flow from background to content to server
2. Update VisitData class to include group_id, tab_id, opener_tab_id fields
3. Modify TabHistory to track group_id (generate for root tabs, inherit for child tabs)
4. Update message router to include group data when content script requests referrer
5. Modify content script to include group fields in visit data payload
6. Update mock server and tests to validate group connections
7. Test with multiple scenarios: new tabs, popups, same-origin navigation

## Implementation Notes

Successfully implemented group connection data tracking for browser extension navigation sessions.

### Approach

- Added group_id, tab_id, and opener_tab_id fields to VisitData and ReferrerInfo classes
- Modified TabHistory to track and inherit group_id from opener tabs
- Updated background script to generate unique group_id for root tabs and inherit for child tabs
- Enhanced message router to pass group connection data to content script
- Modified content script to include group fields in visit payload to server

### Key Features

- Unique group_id generated for each navigation session (timestamp-random format)
- Child tabs inherit group_id from their opener tab
- Opener relationships tracked via opener_tab_id field
- All data sent to server with each visit for proper session grouping

### Technical Decisions

- Used functional approach with immutable data classes
- Group ID format: timestamp-randomstring (e.g., 1754556972712-q20ae3e0t)
- Preserved group_id across same-tab navigations
- Fallback to new group_id if opener history not available

### Testing Results

- Tabs opened via window.open() or target='\_blank' properly share group_id
- Opener relationships correctly tracked and sent to server
- Works even when document.referrer is undefined (GitHub scenario)
- Note: CDP Target.createTarget doesn't preserve opener relationships (test limitation)

### Known Issue

- Child tabs often send visits BEFORE parent tabs due to load timing
- Created follow-up task-16 to handle out-of-order visits in VS Code extension

### Files Modified

- src/types/navigation.ts - Added group connection fields
- src/core/tab_history_manager.ts - Added group_id generation/inheritance
- src/background.ts - Enhanced tab creation to track group_id
- src/core/message_router.ts - Updated to pass group data
- src/core/data_collector.ts - Modified to include group fields
- src/content.ts - Updated to send group connection data
