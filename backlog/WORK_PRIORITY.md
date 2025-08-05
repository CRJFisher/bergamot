# Work Priority

## Current Focus

Working on **Core Extension Functionality** - documenting and cleaning up the webpage processing pipeline.

**Next Task**: Task 5 - Tidy up extension code and document core webpage processing functionality

### Core Extension Functionality

1. **Task 5: Tidy up extension code and document core webpage processing functionality** [HIGH]
   - Document core functionality: browse event listening, workflow processing, vector DB storage
   - Remove remaining dead code from /src
   - Focus on essential webpage processing components

2. **Task 6: Replace LangChain with lightweight alternative** [HIGH]
   - Remove LangChain dependency
   - Implement PocketFlow-ts or similar lightweight library
   - Migrate all LLM functionality

### Intelligent Filtering

1. **Task 7: Add webpage filtering step using LLM classification** [MEDIUM]
   - Use cheap model for page type classification
   - Filter out: interactive web apps, aggregators, leisure content
   - Keep: knowledge and information-rich pages

2. **Task 8: Add agent memory and feedback system for webpage filtering** [MEDIUM]
   - Implement learning from user feedback
   - Create interactive markdown document for recent pages (24h configurable)
   - Allow users to correct filtering decisions

### API & Integration

1. **Task 9: Expose webpage vector DB as RAG service in MCP server** [MEDIUM]
   - Add RAG endpoint to MCP server
   - Enable vector DB queries for webpage content
   - Relates to Task 1 (MCP functionality for RAG)

## Other Backlog Tasks

- Task 1: Investigate adding MCP functionality for RAG on webpage history
- Task 2: Migrate IDE browser communication from HTTP to Native Messaging
- Task 3: Release project as npm package
- Task 3.1: Tidy up repository structure

## Recent Achievements

- ✅ Complete browser extension overhaul to functional architecture
- ✅ 89%+ test coverage with Jest and Chrome DevTools Protocol
- ✅ Comprehensive documentation with API reference
- ✅ Clean functional programming style with immutable state
- ✅ Smart URL normalization and SPA navigation detection
