# Work Priority

## Current Focus

Working on **Enhanced User Experience** - implementing UI features for better interaction with collected webpage data.

**Next Priority**: Task 9 - Expose webpage vector DB as RAG service in MCP server

### API & Integration

1. **Task 9: Expose webpage vector DB as RAG service in MCP server** [HIGH]
   - Add RAG endpoint to MCP server
   - Enable vector DB queries for webpage content
   - Build on existing MCP infrastructure

### User Interface Enhancements

1. **Task 11: Add command to search webpages with dropdown selection** [MEDIUM]
   - VS Code command for webpage search
   - Dropdown list of search results
   - Button to add selected pages to document

2. **Task 12: Add tooltip for webpage links showing database content** [MEDIUM]
   - Hover detection for links in documents
   - Database lookup for matching URLs
   - Display webpage metadata in tooltips

### Advanced Filtering

1. **Task 10: Implement procedural memory for custom filtering rules** [MEDIUM]
   - User-defined filtering rules
   - Pattern-based filtering
   - Integration with episodic memory

## Other Backlog Tasks

1. **Task 2: Migrate IDE browser communication from HTTP to Native Messaging** [LOW]
   - Replace HTTP server with native messaging protocol
   - More secure and reliable communication

2. **Task 3: Release project as npm package** [LOW]
   - Package core functionality
   - Publish to npm registry

3. **Task 3.1: Tidy up repository structure** [LOW]
   - Reorganize files for npm package
   - Depends on Task 3

## Recent Achievements

- ✅ Complete browser extension overhaul to functional architecture (Task 4)
- ✅ 89%+ test coverage with Jest and Chrome DevTools Protocol
- ✅ Comprehensive documentation with API reference
- ✅ Documented core webpage processing architecture (Task 5)
- ✅ Replaced LangChain with vanilla TypeScript (Task 6)
- ✅ Implemented intelligent webpage filtering with LLM (Task 7)
- ✅ Added agent memory and feedback system with episodic memory (Task 8)
- ✅ Created automated Chrome extension debugging scripts (Task 13)
- ✅ MCP server integration for RAG queries (Task 1)

## Next Steps

1. Implement RAG service endpoints in MCP server (Task 9)
2. Add user-friendly search and tooltip features (Tasks 11, 12)
3. Extend memory system with procedural rules (Task 10)