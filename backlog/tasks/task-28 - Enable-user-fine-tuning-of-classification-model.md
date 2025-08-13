---
id: task-28
title: Enable user fine-tuning of classification model
status: To Do
assignee: []
created_date: '2025-08-13 11:17'
labels: []
dependencies:
  - task-27
---

## Description

Phase 2: Allow users to fine-tune the local classification model to their preferences. This includes adding new classification categories, refining existing ones, and personalizing the model based on their content organization needs. The system should provide an intuitive interface for users to train the model with their own labeled examples.

The tricky, subjective category that we need to focus on is the 'knowledge' category.

This could be achieved by 1. adding the users topics-of-interest to a LLM prompt and 2. by fine-tuning the model on the users own data.

## Acceptance Criteria

- [ ] User interface for managing custom classification categories
- [ ] Ability to add new classification classes
- [ ] Ability to refine/modify existing classification classes
- [ ] Local fine-tuning pipeline that runs in the browser
- [ ] Training data collection from user feedback
- [ ] Model versioning and rollback capability
- [ ] Export/import functionality for custom models
- [ ] Documentation on fine-tuning process
