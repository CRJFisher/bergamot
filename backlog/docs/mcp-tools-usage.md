# MCP Tools Usage Guide

This document describes how to use the MCP (Model Context Protocol) tools exposed by the PKM Assistant extension.

## Overview

The PKM Assistant extension exposes two MCP tools that allow AI agents to search and retrieve content from your browsing history:

1. **semantic_search** - Search through webpage history using semantic similarity
2. **get_webpage_content** - Retrieve the full content of a specific webpage

## Prerequisites

1. The PKM Assistant VSCode extension must be installed and activated
2. An OpenAI API key must be configured in VSCode settings
3. The MCP server should be running (started automatically with the extension)

## Tool Descriptions

### semantic_search

Performs vector similarity search on the user's browsing history to find relevant webpages based on a query.

**Input Schema:**
```json
{
  "name": "semantic_search",
  "arguments": {
    "query": "your search query here",
    "limit": 10  // optional, defaults to 10
  }
}
```

**Output Format:**
```json
[
  {
    "id": "page-session-id",
    "url": "https://example.com/page",
    "title": "Page Title",
    "score": 0.95,
    "preview": "First 200 characters of content..."
  }
]
```

**Example Usage:**
```json
{
  "name": "semantic_search",
  "arguments": {
    "query": "machine learning tutorials",
    "limit": 5
  }
}
```

### get_webpage_content

Retrieves the full content of a specific webpage using its session ID.

**Input Schema:**
```json
{
  "name": "get_webpage_content",
  "arguments": {
    "page_session_id": "unique-page-session-id"
  }
}
```

**Output Format:**
```json
{
  "id": "page-session-id",
  "url": "https://example.com/page",
  "title": "Page Title",
  "content": "Full markdown content of the webpage..."
}
```

**Example Usage:**
```json
{
  "name": "get_webpage_content",
  "arguments": {
    "page_session_id": "abc123-def456-ghi789"
  }
}
```

## Integration with AI Agents

### Claude Desktop

To use these tools with Claude Desktop:

1. Ensure the PKM Assistant extension is running in VSCode
2. The MCP server will be available at the configured port
3. Claude can access the tools through the MCP protocol

### Other MCP-Compatible Agents

Any agent that supports the MCP protocol can use these tools by:

1. Connecting to the MCP server (started by the VSCode extension)
2. Listing available tools using the MCP protocol
3. Calling tools with the appropriate arguments

## Common Use Cases

### Finding Related Content

Use `semantic_search` to find pages related to a topic:

```json
{
  "name": "semantic_search",
  "arguments": {
    "query": "React hooks useState useEffect",
    "limit": 10
  }
}
```

### Research Assistant

1. Search for relevant pages on a topic
2. Retrieve full content of the most relevant results
3. Synthesize information across multiple sources

### Knowledge Retrieval

Use the tools to answer questions based on previously visited webpages:

1. Search for pages containing relevant information
2. Retrieve and analyze the full content
3. Extract specific answers or insights

## Troubleshooting

### MCP Server Not Starting

1. Check VSCode Developer Tools console for errors
2. Ensure OpenAI API key is configured
3. Verify extension is activated

### Search Returns No Results

1. Ensure webpages have been processed by the extension
2. Check that the LanceDB memory store contains data
3. Try broader search queries

### Content Retrieval Fails

1. Verify the page_session_id is correct
2. Check if the page has been processed and stored
3. Look for decompression errors in the logs

## Technical Details

- Search uses OpenAI embeddings (text-embedding-3-small model)
- Content is stored compressed using zstd compression
- The memory store uses LanceDB for vector similarity search
- Both tools operate on the same webpage dataset