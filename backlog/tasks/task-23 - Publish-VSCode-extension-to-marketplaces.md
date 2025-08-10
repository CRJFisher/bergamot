---
id: task-23
title: Publish VSCode extension to marketplaces
status: To Do
assignee: []
created_date: '2025-08-10 19:58'
labels: []
dependencies: []
---

## Description

Set up automated publishing of the VSCode extension to both the official VSCode Marketplace and Open VSX Registry. This includes creating a CI/CD pipeline for automated deployment and documenting any manual steps required for the initial setup and ongoing maintenance.

## Acceptance Criteria

- [ ] VSCode extension published to official VSCode Marketplace
- [ ] VSCode extension published to Open VSX Registry (open-vsx.org)
- [ ] CI/CD pipeline configured for automated publishing on releases
- [ ] Personal Access Tokens (PATs) securely stored as CI secrets
- [ ] GitHub Actions workflow created for marketplace publishing
- [ ] Manual setup steps documented in task implementation notes
- [ ] Version bumping and changelog generation automated
- [ ] Pre-publish validation checks implemented (linting testing building)
- [ ] Publishing triggered by GitHub release or tag creation
- [ ] Both marketplaces stay in sync with same version numbers
