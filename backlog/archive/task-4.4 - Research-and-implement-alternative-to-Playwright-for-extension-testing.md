---
id: task-4.4
title: Research and implement alternative to Playwright for extension testing
status: Done
assignee: []
created_date: '2025-08-04 22:11'
labels: []
dependencies: []
parent_task_id: task-4
---

## Description

Research alternatives to Playwright that can persist extension state between page navigations. If found, implement the alternative and expand tests to include multi-page sessions and state tracking in background.ts
Is there a way to drive an actual, real browser and monitor the console of the pages as well as the background.ts script? Do any browsers support this?

## Acceptance Criteria

- [x] Alternative testing frameworks researched and documented
- [x] Comparison of frameworks including state persistence capabilities
- [x] Decision made on framework selection
- [x] If alternative chosen then implemented and configured
- [x] If alternative chosen then multi-page session tests created
- [x] If alternative chosen then background.ts state tracking tests implemented
- [x] If no alternative then document Playwright limitations and workarounds

## Implementation Notes

Researched multiple alternatives in `backlog/docs/browser-extension-testing-alternatives.md`:

- Selenium WebDriver - Good option with state persistence
- Puppeteer - Chrome-only but good performance
- Chrome DevTools Protocol (CDP) - Selected as best option
- WebDriver BiDi - Not ready yet

Selected **Chrome DevTools Protocol (CDP)** because:

- Maintains extension state across navigations
- Launches isolated Chrome instance (no interference)
- Full access to all contexts (background, content, page)
- Can monitor console logs from all contexts

Implemented CDP test runner in:

- `e2e/cdp_extension_test.ts` - TypeScript implementation with full type safety
- `e2e/cdp-extension-test.js` - JavaScript example

Key features:

- Isolated Chrome instance with temporary profile
- State persistence verification
- Console log monitoring from all contexts
- Multi-tab testing support

## Completed Test Implementations

Created comprehensive CDP test suites:

1. **Multi-Page Session Tests** (`e2e/cdp_multi_page_tests.ts`):
   - Basic navigation with referrer tracking
   - New tab referrer inheritance
   - SPA navigation detection
   - Complex navigation chains
   - State persistence verification

2. **Background Script State Tests** (`e2e/cdp_background_state_tests.ts`):
   - Tab history creation and storage
   - Tab history updates on navigation
   - Opener tab relationship tracking
   - SPA state updates via messages
   - Tab removal cleanup
   - Message routing verification

Added npm scripts:

- `npm run test:cdp` - Basic CDP test
- `npm run test:cdp:multi` - Multi-page session tests
- `npm run test:cdp:background` - Background script state tests
