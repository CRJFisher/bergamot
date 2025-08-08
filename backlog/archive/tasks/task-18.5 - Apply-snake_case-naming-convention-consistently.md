---
id: task-18.5
title: Apply snake_case naming convention consistently
status: Done
assignee: []
created_date: '2025-08-07 20:40'
updated_date: '2025-08-08 13:07'
labels: []
dependencies: []
parent_task_id: task-18
---

## Description

Refactor all TypeScript code to use snake_case for variables, functions, and files (except classes which should be PascalCase) as per project coding standards

## Acceptance Criteria

- [x] All variable names converted to snake_case
- [x] All function names converted to snake_case
- [x] All file names converted to snake_case
- [x] Class names remain in PascalCase
- [x] Import statements updated for renamed files
- [x] No functionality broken by renaming

## Implementation Notes

Successfully created a comprehensive TypeScript naming convention checker and fixed ALL violations in the codebase.

## Implementation Details:

1. **Created Naming Convention Checker Script** (scripts/check_naming_conventions.ts)
   - TypeScript-based validation tool using regex patterns (per user preference over AST parsing)
   - Checks both vscode/src and browser-extension/src directories
   - Validates snake_case for variables/functions, PascalCase for classes/interfaces/types
   - Includes intelligent detection for Schemas, Specs, and Annotations
   - Features whitelist for legitimate exceptions
   - Provides detailed violation reports with file:line locations
   - Executable via: `npx tsx scripts/check_naming_conventions.ts`

2. **Fixed All Naming Violations**:
   - **mcp_server_standalone.ts**: Fixed function names (handleSemanticSearch → handle_semantic_search, etc.)
   - **markdown_db.ts**: Fixed variable names (currentBlock → current_block, childLines → child_lines, etc.)
   - **lance_db.ts**: Fixed variables (queryVector → query_vector, tableName → table_name, etc.)
   - **episodic_memory_store.ts**: Fixed typed variables (typedRow → typed_row, etc.)
   - **procedural_memory_store.ts**: Fixed variables (subCondition → sub_condition, etc.)
   - **Fixed filename**: Removed space from " suggestion_decorations.ts" → "suggestion_decorations.ts"
   - Updated all references to renamed items throughout the codebase

3. **Eliminated False Positives**:
   - Added whitelist for legitimate PascalCase names (Zod schemas, Specs, Annotations)
   - Improved detection logic to recognize naming patterns
   - Excluded __mocks__ directories from checks
   - Allowed single lowercase words as valid snake_case
   - Final result: **0 violations** - "✅ All naming conventions are correct!"

4. **Testing**: All 284 tests passing in 16 test suites after refactoring

## Files Modified:
- scripts/check_naming_conventions.ts - Created comprehensive validation script
- vscode/src/mcp_server_standalone.ts - Fixed function and variable names
- vscode/src/markdown_db.ts - Fixed multiple camelCase variables
- vscode/src/lance_db.ts - Fixed variable naming throughout
- vscode/src/memory/episodic_memory_store.ts - Fixed typed variable names
- vscode/src/memory/procedural_memory_store.ts - Fixed variable names
- vscode/src/suggestion_decorations.ts - Renamed file to remove space

## Future Integration Opportunities:
- Add the script to CI pipeline in GitHub Actions for automated checking
- Configure as git pre-commit hook to prevent violations before commit
- Consider adding --fix flag for automatic correction of simple violations
