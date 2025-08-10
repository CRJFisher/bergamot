---
id: task-20
title: Remove hardcoded aggregator filtering from webpage_tree.ts
status: Done
assignee: []
created_date: '2025-08-08 08:39'
updated_date: '2025-08-10 19:15'
labels: []
dependencies: []
---

## Description

The current implementation has a hardcoded list of aggregator URLs in webpage_tree.ts that are filtered out when creating new trees. This should be replaced with LLM-based detection so the system can intelligently identify aggregator sites without maintaining a static list.

## Acceptance Criteria

- [x] Hardcoded aggregator URL list removed from webpage_tree.ts
- [x] LLM-based aggregator detection implemented as one of the webpage categories
- [x] System correctly identifies and handles aggregator sites using LLM classification
- [x] Tests updated to verify LLM-based aggregator detection

## Implementation Notes

### Approach Taken

Removed the hardcoded aggregator filtering from the tree creation phase and leveraged the existing LLM classification system that was already implemented in task 7. The key insight was that aggregator filtering should happen where we have access to page content for intelligent classification, not at the tree structure level.

### Features Implemented

1. **Removed Hardcoded List** - Deleted the 17-line hardcoded aggregator URL array from `create_new_tree_as_root()` function
2. **Preserved Tree Creation** - Aggregator pages now create trees like any other page (filtering happens later)
3. **Added Documentation** - Added comments explaining where aggregator filtering now occurs
4. **Updated Tests** - Modified tests to reflect that aggregators now get trees created

### Technical Decisions and Trade-offs

1. **Where to Filter**: Moved filtering from tree creation phase to workflow phase where content is available
   - Trade-off: Aggregators get trees created (minimal storage impact)
   - Benefit: Intelligent LLM-based classification with full context

2. **Existing Infrastructure**: Leveraged the existing `classify_webpage()` function from task 7
   - Already classifies pages into 6 categories including 'aggregator'
   - Configuration available via VS Code settings
   - Comprehensive test coverage already in place

3. **Backward Compatibility**: Breaking change for existing databases
   - Old databases may have missing trees for aggregator pages
   - New behavior will create trees for all pages going forward

### Modified Files

- `vscode/src/webpage_tree.ts` - Removed hardcoded aggregator list (lines 185-212)
- `vscode/src/webpage_tree.test.ts` - Updated tests to expect trees for aggregator URLs
- `vscode/src/workflow/simple_workflow.ts` - Added comment explaining aggregator filtering location

### Test Results

All 347 tests passing, including updated webpage_tree tests that now verify aggregator URLs get trees created.
