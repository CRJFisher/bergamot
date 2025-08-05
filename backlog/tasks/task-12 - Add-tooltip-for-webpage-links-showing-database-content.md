---
id: task-12
title: Add tooltip for webpage links showing database content
status: Done
assignee: []
created_date: '2025-08-05 09:19'
updated_date: '2025-08-05 11:36'
labels: []
dependencies: []
---

## Description

Implement tooltips that appear when hovering over links in documents. If the link corresponds to a webpage stored in the database, the tooltip should display relevant webpage data like title, summary, and key information. This provides quick access to webpage metadata without leaving the current document.

## Acceptance Criteria

- [x] Hover detection for links in documents
- [x] Database lookup for matching URLs
- [x] Tooltip display with webpage metadata
- [x] Show title and summary in tooltip
- [x] Performance optimization for quick tooltips

## Implementation Plan

1. Create HoverProvider for markdown links
2. Extract URL from hover position using document parsing
3. Query database for webpage content by URL
4. Format tooltip content with title, summary, and metadata
5. Register hover provider for markdown files
6. Implement caching for performance
7. Add configuration for tooltip content options
8. Test hover functionality on various link formats

## Implementation Notes

Implemented hover provider to show webpage metadata when hovering over links in documents.

### Features Implemented

1. **Hover Provider**:
   - Detects URLs in markdown links and plain text
   - Queries database for matching webpage content
   - Shows formatted tooltip with webpage information

2. **URL Detection**:
   - Supports markdown link format: [text](url)
   - Supports plain URLs in text
   - Accurate position detection for hover activation

3. **Tooltip Content**:
   - Shows webpage title with emoji icon
   - Displays full URL
   - Shows visited date/time if available
   - Includes content preview (first 500 chars)

4. **Performance**:
   - Implements caching to avoid repeated database queries
   - Cache cleared on configuration changes
   - Handles missing webpages gracefully

### Technical Decisions

- Created WebpageHoverProvider class for clean separation
- Used both DuckDB and memory store for comprehensive data
- Registered for markdown and plaintext files
- Cache implemented as Map for O(1) lookups

### Files Modified

- src/webpage_hover_provider.ts - New file with hover provider
- src/duck_db.ts - Added get_webpage_by_url function
- src/extension.ts - Register hover provider
- No package.json changes needed (hover providers are automatic)
