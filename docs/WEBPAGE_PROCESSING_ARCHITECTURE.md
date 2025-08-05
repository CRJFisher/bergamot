# Webpage Processing Architecture

This document describes the core functionality of the PKM Assistant's webpage processing pipeline.

## Overview

The PKM Assistant consists of two main components:
1. **Browser Extension** (in `/referrer_tracker_extension/`) - Captures webpage visits
2. **VS Code Extension** (in `/src/`) - Processes and stores webpage data

## Data Flow

```
Browser Extension → HTTP POST → VS Code Extension → Processing Workflow → Vector DB + DuckDB
```

## 1. Browse Event Listening

The browser extension (`referrer_tracker_extension/`) listens to webpage navigation events:

### Content Script (`src/content.ts`)
- Detects page loads and SPA navigation events
- Monitors `pushState`, `replaceState`, and `popstate` events
- Collects page content using `extract_page_content()`
- Compresses content using zstd compression

### Background Script (`src/background.ts`)
- Maintains tab history across browser tabs
- Tracks referrer information and navigation chains
- Provides referrer data to content scripts

### Data Collection
When a page is visited, the extension collects:
```typescript
{
  url: string,
  referrer: string,
  referrer_timestamp?: number,
  content: string,  // zstd compressed, base64 encoded
  page_loaded_at: string  // ISO timestamp
}
```

## 2. Workflow Processing

The VS Code extension receives webpage data at the `/visit` endpoint:

### HTTP Server (`src/extension.ts`)
- Express server running on port 5000
- Receives POST requests from browser extension
- Decompresses zstd content
- Validates payload using Zod schemas

### Queue Processing
- Requests are queued to prevent overwhelming the system
- Sequential processing ensures orderly workflow execution
- Each page visit triggers the reconciliation workflow

### Webpage Tree Management (`src/webpage_tree.ts`)
- Groups related pages into "trees" based on domain/path patterns
- Manages page relationships and navigation hierarchies
- Triggers workflow when tree membership changes

## 3. Reconciliation Workflow (`src/reconcile_webpage_trees_workflow.ts`)

The core processing pipeline uses LangChain's LangGraph:

### Workflow Steps:
1. **Analyze Page** - Extract semantic information from page content
2. **Determine Tree Intentions** - Understand the purpose of the webpage tree
3. **Generate Analysis** - Create structured analysis of the page
4. **Store Results** - Save to both DuckDB and vector database

### State Management
```typescript
AgentStateAnnotation = {
  tree: WebpageTreeNode,
  members: PageActivitySessionWithMeta[],
  new_page: PageActivitySessionWithoutContent,
  raw_content: string,
  page_analysis: PageAnalysis,
  tree_intentions: TreeIntentions,
  ...
}
```

## 4. Vector DB Storage

### LanceDB Integration (`src/agent_memory.ts`)
- Stores webpage content embeddings
- Uses OpenAI's `text-embedding-3-small` model
- Enables semantic search across webpage history
- Namespace: `webpage_content`

### Storage Operations:
1. Content is embedded using OpenAI embeddings
2. Stored with metadata (URL, timestamp, analysis)
3. Searchable via semantic similarity

## 5. DuckDB Storage (`src/duck_db.ts`)

Structured data storage for:
- **page_activity_sessions** - Raw webpage visit data
- **webpage_trees** - Hierarchical groupings of pages
- **webpage_analysis** - AI-generated page analysis
- **webpage_tree_intentions** - Purpose/intent of page groups
- **webpage_content** - Compressed page content

### Key Tables:
```sql
- page_activity_sessions: Core visit records
- webpage_trees: Domain/path based groupings
- webpage_analysis: Semantic analysis results
- webpage_tree_intentions: Tree-level understanding
- webpage_content: Full page content storage
```

## 6. MCP Server Integration (`src/mcp_server.ts`)

The Model Context Protocol server exposes:
- RAG functionality for querying webpage history
- Semantic search capabilities
- Integration with AI assistants

## Dependencies

### Core Libraries:
- **LangChain/LangGraph** - Workflow orchestration
- **DuckDB** - Structured data storage
- **LanceDB** - Vector database
- **OpenAI** - Embeddings and LLM analysis
- **Express** - HTTP server
- **zstd** - Content compression

### Browser Extension:
- Chrome Extension API (Manifest V3)
- Functional TypeScript architecture
- Jest for testing