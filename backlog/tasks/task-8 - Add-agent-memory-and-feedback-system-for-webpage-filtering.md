---
id: task-8
title: Add agent memory and feedback system for webpage filtering
status: Done
assignee:
  - '@chuck'
created_date: '2025-08-05 06:22'
updated_date: '2025-08-05 09:20'
labels: []
dependencies: []
---

## Description

Implement agent memory for webpage processing that can take human feedback and update filtering decisions. Include a markdown document showing pages from a configurable time period (e.g. 24h) with interactive elements allowing users to provide feedback on filtering decisions.

The feedback document should be named `__recent_webpages__.md` and have two sections:

- `## Recent webpages`: Shows accepted pages from the last 7 days (configurable)
- `## Filtered out webpages`: Shows filtered pages from the last 48 hours (configurable)

For each page, it should indicate whether it was filtered out or accepted, along with a very brief reason (<10 words). All filtered-in webpages should be stored in the vector DB and DuckDB for metadata.

## Acceptance Criteria

- [x] Read `langmem course notebooks/langgraph_memory_guide.md` and extract the key ideas into a document so we can use this to implement non-langgraph code
- [x] Agent memory system implemented for filter learning
- [x] Feedback collection mechanism created
- [x] Markdown document generator for recent pages
- [ ] Interactive elements for user feedback (clickable with text box)
- [x] Configurable time period for page display
- [x] Filter updates based on user feedback
- [x] Persistence of learned filtering rules
- [x] Separate sections for accepted and filtered pages with different time windows
- [x] Storage of all accepted pages in vector DB and DuckDB

## Implementation Plan

1. Extract key ideas from LangGraph memory guide
2. Research agent memory patterns (semantic, episodic, procedural)
3. Design memory architecture for webpage filtering
4. Implement episodic memory storage schema
5. Create feedback collection mechanism
6. Build markdown document writer using `src/markdown_db.ts` for recent pages, marking them with filtering decisions and reasoning
7. Implement memory retrieval for classification enhancement
8. Add VS Code command for feedback review
9. Test memory persistence and retrieval
10. Add configuration for time windows

## Implementation Notes

### Research and Design Phase

- Created comprehensive `docs/AGENT_MEMORY_RESEARCH.md` documenting three types of agent memory:
  - Semantic Memory: General knowledge about webpage patterns
  - Episodic Memory: Specific instances of webpage classifications
  - Procedural Memory: Custom filtering rules and procedures
- Designed architecture for memory-enhanced webpage filtering using DuckDB and LanceDB

### Core Implementation

- **Episodic Memory Store** (`src/memory/episodic_memory_store.ts`):
  - Stores webpage classification episodes in DuckDB
  - Supports user corrections and feedback
  - Integrates with LanceDB for vector similarity search
  - Tracks reasoning field with <10 word constraint from LLM

- **Memory-Enhanced Classifier** (`src/memory/memory_enhanced_classifier.ts`):
  - Wraps base classifier with memory-based adjustments
  - Adjusts confidence based on similar past corrections
  - Can override decisions based on consistent user feedback
  - Stores episodes with brief reasoning from LLM

- **Feedback Document Generator** (`src/memory/feedback_document_generator.ts`):
  - Generates `__recent_webpages__.md` using markdown-db
  - Two sections: Recent webpages (accepted) and Filtered out webpages
  - Marks corrected pages with ⚠️ indicator
  - Configurable time windows: 7 days for accepted, 48h for filtered

- **VS Code Commands** (`src/memory/feedback_commands.ts`):
  - `PKM Assistant: Generate Filtering Review` - Creates feedback document
  - `PKM Assistant: Show Memory Statistics` - Displays correction statistics
  - Commands for correcting decisions and types (not yet fully interactive)

### Integration Points

- Updated `src/workflow/webpage_filter.ts` prompt to request reasoning in <10 words
- Modified `src/workflow/simple_workflow.ts` to use memory-enhanced classification
- Integrated episodic memory initialization in `src/extension.ts`
- Added configuration options in `package.json` for agent memory

### Key Technical Decisions

- Used existing `reasoning` field instead of adding new field
- Leveraged markdown-db for feedback document storage
- Implemented confidence adjustment algorithm based on similar corrections
- DuckDB schema includes all necessary fields for episodic memory

### Remaining Work

- Interactive feedback collection moved to Task 11 (webpage search command)
- Full testing of memory persistence and retrieval
- UI improvements moved to Task 12 (tooltip feature)

### Final Implementation Updates

- Updated `FeedbackDocumentGenerator` to create two sections:
  - `## Recent webpages`: Shows accepted pages from last 7 days (configurable)
  - `## Filtered out webpages`: Shows filtered pages from last 48 hours (configurable)
- Added configuration options in package.json:
  - `pkm-assistant.agentMemory.recentPagesDays`: Days to show accepted pages (default: 7)
  - `pkm-assistant.agentMemory.filteredPagesHours`: Hours to show filtered pages (default: 48)
- Updated document format with cleaner styling (strikethrough for filtered pages)
- Created follow-up tasks for advanced UI features:
  - Task 11: Search command with dropdown selection
  - Task 12: Tooltip feature for webpage links
