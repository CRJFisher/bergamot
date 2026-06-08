---
id: DRAFT-2
title: Enable user fine-tuning of classification model
status: To Do
assignee: []
created_date: "2025-08-13 11:17"
labels: []
dependencies:
  - task-27
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

> **Privacy-model reconciliation (canonical).** This draft inherits draft-1's rescope. "The user's data" here means **re-downloaded public content and its metadata** (obtained during post-processing on Node/desktop), never capture-time browser page content — capture is metadata-only. Fine-tuning and training-data collection run over that re-downloaded/metadata corpus on Node/desktop, not in the capture-time browser context. If draft-1's classification purpose was **ingestion-time sensitivity gating**, that purpose is **moot** (the login-wall-at-re-download filter supersedes it), and this draft is **correspondingly moot**. It survives only insofar as draft-1 survives — i.e. as user fine-tuning of RAG-prep page-type classification over already-public re-downloaded content.

Phase 2: Allow users to fine-tune the local classification model to their preferences. This includes adding new classification categories, refining existing ones, and personalizing the model based on their content organization needs. The system should provide an intuitive interface for users to train the model with their own labeled examples.

The tricky, subjective category that we need to focus on is the 'knowledge' category.

This could be achieved by 1. adding the users topics-of-interest to a LLM prompt and 2. by fine-tuning the model on the users own data.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 User interface for managing custom classification categories
- [ ] #2 Ability to add new classification classes
- [ ] #3 Ability to refine/modify existing classification classes
- [ ] #4 Local fine-tuning pipeline that runs in the browser
- [ ] #5 Training data collection from user feedback
- [ ] #6 Model versioning and rollback capability
- [ ] #7 Export/import functionality for custom models
- [ ] #8 Documentation on fine-tuning process
<!-- AC:END -->
