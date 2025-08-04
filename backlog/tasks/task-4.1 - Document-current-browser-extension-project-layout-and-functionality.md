---
id: task-4.1
title: Document current browser extension project layout and functionality
status: Done
assignee:
  - '@claude'
created_date: '2025-08-04 22:11'
updated_date: '2025-08-04 22:14'
labels: []
dependencies: []
parent_task_id: task-4
---

## Description

Document the current project structure, build process, testing setup, and overall functionality of the referrer_tracker_extension

## Acceptance Criteria

- [x] Project structure documented including all directories and their purposes
- [x] Build process documented with all scripts and configurations
- [x] Testing setup documented including current framework and limitations
- [x] Overall functionality overview created

## Implementation Plan

1. Explore the referrer_tracker_extension directory structure
2. Document all directories and their purposes
3. Analyze package.json for build scripts and dependencies
4. Document the build process and configuration files
5. Examine test setup and document testing framework
6. Create overview of extension functionality from manifest.json
7. Document key components and their interactions

## Implementation Notes

Created comprehensive documentation in `backlog/docs/browser-extension-project-structure.md` that covers:

- **Project Structure**: Documented all directories with their purposes and organization
- **Build Process**: Detailed both regular and test builds using ESBuild, including the post-build copy process
- **Testing Setup**: Documented Jest unit testing and Playwright E2E testing configurations
- **Testing Limitations**: Explicitly documented the Playwright state persistence issue that prevents testing multi-page sessions
- **Extension Functionality**: Covered core features, permissions, and API endpoints
- **Components**: Documented the three main components (background.ts, content.ts, url_cleaning.ts)
- **Dependencies**: Listed both runtime and development dependencies

Key findings:
- Uses Manifest V3 for both Chrome and Firefox
- Build process uses ESBuild for fast TypeScript bundling
- Testing has significant limitations with Playwright not persisting extension state between navigations
- Extension tracks navigation chains and reports to a PKM server (default localhost:5000)
