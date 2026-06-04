# MCP RAG Architecture for Webpage History

This document describes the architecture for exposing webpage browsing history through MCP (Model Context Protocol) tools for Retrieval-Augmented Generation (RAG).

## Storage Architecture

The system stores webpage content using a `LanceDBMemoryStore`, which provides the foundation for RAG capabilities. Relational visit metadata is stored separately in DuckDB.

## Core Components

The system is composed of the following components:

- **Data Source:** The user's browsing history, captured as a series of webpage visits.
- **Content Processing:** An LLM extracts the main content from a webpage and converts it to Markdown.
- **Storage:** A `LanceDBMemoryStore` instance that stores the processed webpage content and associated metadata, alongside DuckDB for relational visit records.
- **MCP Server:** An MCP server that exposes tools for searching and retrieving webpage content.

## Implementation

When a new webpage visit is processed, its raw HTML content is processed by an LLM to extract the main content in Markdown format. This processed content, along with metadata such as the URL and title, is stored in a `LanceDBMemoryStore`.

The `LanceDBMemoryStore` uses a LanceDB table to store the documents. Vector embeddings are generated locally with the all-MiniLM-L6-v2 model (384-dim, via `@xenova/transformers`), enabling semantic search capabilities with zero API tokens.

## MCP Integration

### MCP Server Architecture

The MCP server runs as a separate process that:

1. Connects to the `LanceDBMemoryStore`
2. Exposes two primary content tools (alongside relational query tools):
   - `semantic_search`: Performs vector similarity search on webpage content
   - `get_webpage_content`: Retrieves full content for a specific webpage

### Tool Definitions

#### semantic_search

```typescript
{
  name: "semantic_search",
  description: "Search through the user's browsing history using semantic similarity",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to find relevant webpages"
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return",
        default: 10
      }
    },
    required: ["query"]
  }
}
```

#### get_webpage_content

```typescript
{
  name: "get_webpage_content",
  description: "Retrieve the full content of a specific webpage by ID",
  inputSchema: {
    type: "object",
    properties: {
      page_session_id: {
        type: "string",
        description: "The unique identifier of the webpage session"
      }
    },
    required: ["page_session_id"]
  }
}
```

## Operational Concerns

### MCP Server Lifecycle Management

The MCP server lifecycle is integrated into the VS Code extension's activation and deactivation, so the server starts and stops with the extension.

### Concurrent Access to LanceDB

The MCP server reads from the same LanceDB instance used by the extension, accessing it in a read-only mode to avoid contention between processes.

### Performance with Large Datasets

Search performance is kept stable across large datasets through caching of embeddings and search results.
