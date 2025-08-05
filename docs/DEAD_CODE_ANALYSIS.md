# Dead Code Analysis

## Files to Remove

### 1. Completely Commented Out Files
These files contain only commented-out code and can be safely removed:

- `src/suggestion_decorations.ts` - UI decorations (commented out)
- `src/suggestions_page_decorations.ts` - Suggestions page UI (commented out)
- `src/home_page.ts` - Home page population (commented out)

### 2. Test Files
Keep for now as they provide test coverage:
- `src/markdown_db.test.ts`
- `src/mcp_server.test.ts` 
- `src/webpage_tree.test.ts`

### 3. Mock Files
Keep for testing:
- `src/__mocks__/` directory

## Files to Keep

### Core Webpage Processing Pipeline
- `src/extension.ts` - Main VS Code extension entry point
- `src/reconcile_webpage_trees_workflow.ts` - Core processing workflow
- `src/webpage_tree.ts` - Webpage grouping logic
- `src/duck_db.ts` - Database operations
- `src/agent_memory.ts` - Vector database operations
- `src/mcp_server.ts` - MCP server implementation
- `src/mcp_server_standalone.ts` - Standalone MCP server

### Data Models
- `src/duck_db_models.ts` - Database schemas
- `src/webpage_tree_models.ts` - Tree data structures
- `src/reconcile_webpage_trees_workflow_models.ts` - Workflow models
- `src/model_schema.ts` - General schemas

### Utilities
- `src/hash_utils.ts` - Hashing utilities
- `src/vscode_openai_model.ts` - OpenAI model integration
- `src/markdown_db.ts` - Markdown database operations
- `src/note_tools.ts` - Note scanning (used by agent_memory)

## Code to Clean Up

### In extension.ts
Remove commented lines:
- Lines 103-104: Decoration setup calls
- Line 106: repopulate_home_page call
- Lines 111-155: Entire repopulate_home_page function (unused)

### Dependencies to Consider Removing
After completing Task 6 (Replace LangChain):
- All `@langchain/*` imports
- Related configuration and setup code