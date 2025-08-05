---
id: task-7
title: Add webpage filtering step using LLM classification
status: Done
assignee:
  - '@chuck'
created_date: '2025-08-05 06:22'
updated_date: '2025-08-05 08:42'
labels: []
dependencies: []
---

## Description

Add a preprocessing step to webpage processing that uses a cheap model to filter for page type, keeping only pages that contain useful knowledge information while removing interactive web apps, aggregators, leisure content etc

## Acceptance Criteria

- [x] Page classification step implemented in workflow
- [x] Cheap LLM model integrated for classification
- [x] Filter rules defined for knowledge vs non-knowledge content
- [x] Configuration for filter criteria
- [x] Metrics/logging for filtered pages

## Implementation Plan

1. Analyze current workflow to identify insertion point for filtering
2. Design page classification schema and filter criteria
3. Create webpage_filter.ts with classification logic
4. Integrate cheap model (gpt-4o-mini) for classification
5. Add configuration for filter rules
6. Update workflow to include filtering step
7. Add logging for filter decisions
8. Write tests for filtering logic

## Implementation Notes

Successfully implemented webpage filtering with LLM classification:

- Created webpage_filter.ts with classification logic using gpt-4o-mini
- Added 6 page type categories: knowledge, interactive_app, aggregator, leisure, navigation, other
- Implemented configurable filter rules via VS Code settings
- Added filter_metrics.ts for tracking filtering performance
- Integrated filtering early in workflow before content processing
- Added VS Code command to view filter metrics
- Comprehensive test coverage for all filter functions

Key features:
- Classification based on URL and first 2000 chars of content
- Configurable allowed page types and confidence threshold
- Model can override classification with should_process flag
- Detailed logging of filter decisions
- Metrics tracking for filter performance analysis
- VS Code settings for runtime configuration

Configuration options:
- pkm-assistant.webpageFilter.enabled
- pkm-assistant.webpageFilter.allowedTypes
- pkm-assistant.webpageFilter.minConfidence
- pkm-assistant.webpageFilter.logDecisions
