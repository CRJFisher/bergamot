# MCP RAG Architecture for Webpage History

This document outlines the architecture for exposing webpage browsing history through MCP (Model Context Protocol) tools for Retrieval-Augmented Generation (RAG).

## Current Storage Architecture

The system currently stores webpage content using a `LanceDBMemoryStore`, which provides the foundation for RAG capabilities.

## Core Components

The system is composed of the following components:

*   **Data Source:** The user's browsing history, captured as a series of webpage visits.
*   **Content Processing:** An LLM-based workflow that extracts the main content from a webpage and converts it to Markdown.
*   **Storage:** A `LanceDBMemoryStore` instance that stores the processed webpage content and associated metadata.
*   **MCP Server:** (TO BE IMPLEMENTED) An MCP server that exposes tools for searching and retrieving webpage content.

## Current Implementation

The `reconcile_webpage_trees_workflow` is responsible for processing new webpage visits. As part of this workflow, the raw HTML content of a webpage is processed by an LLM to extract the main content in Markdown format. This processed content, along with metadata such as the URL and title, is then stored in a `LanceDBMemoryStore`.

The `LanceDBMemoryStore` uses an in-memory LanceDB table to store the documents. It is configured with an `OpenAIEmbeddings` model, which is used to generate vector embeddings for the documents, enabling semantic search capabilities.

## Proposed MCP Integration

### MCP Server Architecture

The MCP server should be implemented as a separate process that:
1. Connects to the existing `LanceDBMemoryStore`
2. Exposes two primary tools:
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

## Implementation Challenges and Solutions

### Challenge 1: MCP Server Lifecycle Management
- **Challenge:** The MCP server needs to start/stop with the VSCode extension
- **Solution:** Integrate server lifecycle into extension activation/deactivation

### Challenge 2: Concurrent Access to LanceDB
- **Challenge:** Multiple processes accessing the same LanceDB instance
- **Solution:** Use proper locking mechanisms or implement a read-only mode for MCP server

### Challenge 3: Performance with Large Datasets
- **Challenge:** Search performance may degrade with thousands of webpages
- **Solution:** Implement pagination, caching, and potentially index optimization

## Next Steps

1. Implement the MCP server with the two tools described above
2. Add proper error handling and validation
3. Write comprehensive tests for both tools
4. Update extension documentation with usage examples
5. Consider adding additional tools (e.g., filter by date, domain, etc.)