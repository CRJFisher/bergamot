# E2E Navigation Tests

## Overview

This directory contains comprehensive end-to-end tests for the browser extension's navigation tracking capabilities.

## Test Suites

1. **navigation_e2e_tests.ts** - Traditional navigation, forms, redirects, iframes
2. **spa_navigation_tests.ts** - Single Page Application navigation patterns
3. **multi_tab_navigation_tests.ts** - Tab relationships and cross-tab navigation
4. **edge_cases_tests.ts** - Special scenarios and error conditions

## Running Tests

### Individual Test Suites
```bash
npm run test:e2e           # Basic navigation tests
npm run test:e2e:spa       # SPA navigation tests
npm run test:e2e:multi-tab # Multi-tab tests
npm run test:e2e:edge      # Edge case tests
```

### Run All Tests
```bash
npm run test:e2e:run-all   # Run all tests with summary report
npm run test:e2e:full      # Run all tests sequentially
```

### Simple Server Test
```bash
npx tsx e2e/simple_test.ts # Test the server infrastructure
```

## Prerequisites

1. **Chrome Browser**: Tests require Google Chrome to be installed
2. **Build Extension**: Tests automatically build the extension before running
3. **Port 3456**: Test server runs on port 3456 (must be available)
4. **Port 9222**: Chrome DevTools Protocol uses port 9222

## Test Infrastructure

- **TestServer**: Express server providing mock websites
- **ExtensionTestRunner**: Chrome automation via CDP
- **NavigationVerifier**: Tracks and verifies navigation chains
- **NavigationSimulator**: Programmatic navigation actions

## Known Issues

1. **Chrome Launch**: Tests may hang if Chrome fails to launch properly
   - Solution: Kill any existing Chrome test processes: `pkill -f "chrome-ext-test"`
   
2. **ESM Modules**: All test files use ES modules
   - Uses `tsx` instead of `ts-node` for better ESM support
   
3. **Timing Issues**: Some tests may fail due to timing
   - Adjust timeouts in test files if needed

## Test Coverage

The tests cover:
- Traditional multi-page navigation
- SPA navigation (pushState, hash routing, PJAX)
- Multi-tab relationships and opener tracking
- Iframes and nested frames
- Popup windows
- Form submissions
- Redirects (server, meta, JavaScript)
- Edge cases (data URLs, blob URLs, errors)
- Referrer and metadata tracking

## CI/CD

Tests run automatically on GitHub Actions:
- Multiple OS: Ubuntu, macOS, Windows
- Multiple Node versions: 18.x, 20.x
- See `.github/workflows/e2e-tests.yml`

## Debugging

To debug failing tests:
1. Run individual test suites to isolate issues
2. Check Chrome is installed and accessible
3. Verify no other processes are using ports 3456 or 9222
4. Check console output for specific error messages
5. Use `chrome:debug` script to manually test the extension

## Development

When adding new tests:
1. Add test cases to appropriate suite
2. Use existing helpers (NavigationVerifier, NavigationSimulator)
3. Follow naming conventions for test methods
4. Update this README with new test coverage