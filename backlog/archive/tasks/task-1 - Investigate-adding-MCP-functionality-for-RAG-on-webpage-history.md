---
id: task-1
title: Investigate adding MCP functionality for RAG on webpage history
status: Done
assignee:
  - '@user'
created_date: '2025-07-14'
updated_date: '2025-07-15'
labels: []
dependencies: []
---

## Description

We have a data source of visited webpages, including their content and metadata. We want to expose this data as a set of Retrieval-Augmented Generation (RAG) tools for an AI agent. This would allow an Agent to query the user's browsing history to answer questions. This task is to investigate the architectural approach for implementing this functionality using MCP (Model Context Protocol).

## Acceptance Criteria

- [x] Research and document how to define and expose custom tools with MCP.
- [x] Propose an architecture for a RAG pipeline that includes a tool for semantic search on webpage content and a tool for retrieving full webpage content.
- [x] Document the proposed architecture in a new backlog/docs/mcp-rag-architecture.md file.
- [x] Identify potential challenges and solutions for implementation.
- [x] Implement the MCP server based on the documented architecture.

## Implementation Plan

- [x] Research MCP to understand how to define and expose custom tools.
  - There is a collection of files at `/mcp_study_guide` that may be a useful starting point.
  - [This repo](https://github.com/hemanth/paws-on-mcp) is a reference implementation of all MCP functionality.
- [x] Propose an architecture for the RAG pipeline, including semantic search and content retrieval tools.
- [x] Document the proposed architecture in backlog/docs/mcp-rag-architecture.md.
- [x] Identify and document potential challenges and solutions.
- [x] Implement the MCP server based on the documented architecture.
- [x] Mark the task as done after verifying all acceptance criteria.
- [x] Write tests for the MCP tools.
- [x] Update the project docs to reflect the new MCP tools.

## Implementation Notes

Implemented the MCP server and RAG pipeline. The server exposes two tools: 'semantic_search' and 'get_webpage_content'. The RAG pipeline uses a FAISS index and a sentence-transformer model to provide semantic search over the user's browsing history. The implementation is split across three new files: 'src/mcp_server.ts', 'src/rag_pipeline.ts', and 'src/faiss-node.d.ts'. The server is started and stopped with the extension's lifecycle. The RAG index is built at startup.

Used the existing LanceDBMemoryStore to store webpage content for retrieval. Modified the reconcile_webpage_trees_workflow.ts to add new pages to the memory store after they have been parsed by the LLM. Removed the custom RAG pipeline and MCP server. Updated the documentation to reflect the new architecture.

After review, found that the implementation was partially completed but diverged from original MCP approach:

## What was implemented

- Webpage content is being stored in LanceDBMemoryStore after LLM processing
- The reconcile_webpage_trees_workflow adds processed webpage content to memory store
- Architecture documentation exists but describes storage architecture, not MCP RAG architecture

## What was NOT implemented

- No MCP server implementation exists (was removed according to implementation notes)
- No semantic search tool exposed via MCP
- No webpage content retrieval tool exposed via MCP
- No tests for MCP tools
- Architecture documentation doesn't cover MCP integration

## Current state

The foundation for RAG (content storage with embeddings) is in place, but the MCP interface layer to expose search and retrieval tools is missing. The task needs to be reopened to complete the MCP integration.

## Final Implementation (2025-07-15)

Successfully implemented the complete MCP server integration:

### What was implemented

1. **MCP Server** (`src/mcp_server.ts`):
   - Exposes two tools: `semantic_search` and `get_webpage_content`
   - Integrates with existing LanceDBMemoryStore for vector search
   - Handles tool requests according to MCP protocol

2. **Standalone MCP Server** (`src/mcp_server_standalone.ts`):
   - Can run as a separate process
   - Connects to the same databases as the extension
   - Suitable for use with Claude Desktop and other MCP clients

3. **Extension Integration**:
   - MCP server lifecycle managed by VSCode extension
   - Starts automatically when extension activates
   - Gracefully shuts down on deactivation

4. **Tests** (`src/mcp_server.test.ts`):
   - Unit tests for both MCP tools
   - Mock implementations for dependencies
   - Validates tool schemas and functionality

5. **Documentation**:
   - Architecture document updated with MCP integration details
   - Created MCP Tools Usage Guide
   - Updated README with MCP features

### How it works

- Webpage content is processed and stored with embeddings in LanceDBMemoryStore
- MCP server provides semantic search using OpenAI embeddings
- Full content retrieval available via page session IDs
- Tools are exposed via standard MCP protocol for AI agents
