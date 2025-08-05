---
id: task-3.1
title: Tidy up repository structure
status: Done
assignee: []
created_date: '2025-07-29'
updated_date: '2025-08-05 12:25'
labels: []
dependencies: []
parent_task_id: task-3
---

## Description

Clean up the repository by removing outdated reference documentation and organizing the codebase for public release

## Acceptance Criteria

- [ ] Old reference docs removed
- [ ] Unnecessary files cleaned up
- [ ] Repository structure organized
- [ ] README updated with current information

## Implementation Plan

## Implementation Plan

1. Create monorepo structure with packages/
2. Move /src to /packages/vscode
3. Move /referrer_tracker_extension to /packages/browser
4. Set up changesets for versioning
5. Create root package.json with workspaces
6. Update build scripts for monorepo
7. Clean up old/unused files
8. Update documentation structure
9. Create proper .gitignore for monorepo
