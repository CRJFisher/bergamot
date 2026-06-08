# MCP RAG Architecture for Webpage History

This document describes the architecture for exposing webpage browsing history through MCP (Model Context Protocol) tools for Retrieval-Augmented Generation (RAG).

## Storage Architecture

Browsing **metadata** is the durable source of truth, held in DuckDB (visit id, URL, page-load timestamp, title, navigation/session graph). Page content is never captured. It is obtained later by **re-downloading the public URL during post-processing**; the resulting vectors and any cached content live in a `LanceDBMemoryStore` that is a **derived cache** over the re-downloaded public content, not a source of truth.

## Core Components

The system is composed of the following components:

- **Data Source:** The user's browsing metadata, captured as a series of webpage visits — never page content.
- **Content Acquisition:** A post-processing fetcher re-downloads each stored public URL. Authenticated and paywalled pages fail to re-download (login redirect / 403 / paywall) and are excluded automatically — the login wall is the privacy filter.
- **Content Processing:** An LLM extracts the main content from the re-downloaded page and converts it to Markdown.
- **Storage:** DuckDB holds the metadata record (source of truth). A `LanceDBMemoryStore` instance holds the derived vectors and any cached re-downloaded content. Cached content is encrypted at rest, scoped, and deletable.
- **MCP Server:** An MCP server that exposes tools for searching and retrieving the re-downloaded public content.

## Implementation

During post-processing, the fetcher re-downloads each stored public URL. Pages that fail to re-download (auth-walled, paywalled, dead) remain as trail/metadata only and are **excluded from clustering and retrieval**. For pages that re-download successfully, the raw HTML is processed by an LLM to extract the main content in Markdown format. This processed content, along with metadata such as the URL and title, is stored in the derived `LanceDBMemoryStore`.

The `LanceDBMemoryStore` uses a LanceDB table to store the documents. Vector embeddings are generated locally with the all-MiniLM-L6-v2 model (384-dim, via `@xenova/transformers`), enabling semantic search capabilities with zero API tokens. The clusterable/searchable corpus is the re-downloadable public subset; Temporal Topic Detection runs first over that corpus, and RAG-based retrieval comes after.

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
