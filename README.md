# Bergamot

> Transform your web browsing into a queryable knowledge base accessible via MCP for AI-powered PKM workflows

## Why Bergamot?

Every day, you browse dozens of valuable webpages - documentation, tutorials, articles, and research. But this knowledge gets lost in browser history. Bergamot solves this by:

1. **Automatic Capture**: Silently captures knowledge-rich pages as you browse
2. **Intelligent Storage**: Stores content in both structured and vector databases
3. **MCP Access**: Exposes your knowledge to AI agents for powerful PKM workflows
4. **Semantic Search**: Find information using natural language, not just keywords

The result? Your browsing becomes a permanent, searchable knowledge base that AI assistants can query to help with research, writing, learning, and problem-solving.

## Overview

Bergamot automatically captures knowledge-rich webpages as you browse, stores them in a searchable database, and exposes them through an MCP server for AI-powered knowledge management tasks. It transforms your browsing history into a queryable knowledge base that you can access programmatically or through intuitive interfaces.

### Core Components

- **Browser Extension** (`@bergamot/browser-extension`) - Captures and filters webpages you visit, focusing on knowledge-rich content
- **VS Code Extension** (`@bergamot/vscode`) - Provides search, management, and MCP server for accessing your knowledge base
- **MCP Server** - Exposes your browsing knowledge to AI agents for RAG queries and PKM workflows

## Key Features

### 🌐 Capture

- Automatically captures webpages as you browse
- Skips only transient interstitials — login, redirect, and empty pages
- Preserves full navigation context and referrer chains

### 💾 Store

- Persists each visit to DuckDB: a relational visit record plus the raw page, stored losslessly (zstd-compressed) as the durable source of truth
- Reads cheap `<head>` metadata (title, author, publication) at capture time

### 🔍 Query

- **MCP server** for AI agents — `semantic_search` and `get_webpage_content`, plus relational tools
- **HTTP query API** for scripts
- **Direct read-only DuckDB access** when the extension is not running

## Installation

### Prerequisites

- Node.js >= 18.0.0
- VS Code >= 1.60.0
- A Chromium-based browser (Chrome, Edge, or Brave)

### Quick Start

1. **Install the VS Code Extension**

   ```bash
   # From VS Code
   ext install bergamot.bergamot
   ```

2. **Install the Browser Extension**
   - Chrome / Edge / Brave: Chrome Web Store (coming soon)
   - Or build from source (see Development section)

3. **No API key required**
   - Capture runs locally and deterministically; no API tokens are needed.

## Usage

### Building Your Knowledge Base

1. Install the browser extension
2. Browse normally — Bergamot automatically captures the pages you visit
3. Each page's raw HTML is stored losslessly for future retrieval

### Accessing Your Knowledge via MCP

The MCP server enables AI agents to query your browsing knowledge:

```javascript
// Example: Using with Claude or other MCP-compatible agents
await use_mcp_tool("semantic_search", {
  query: "React hooks best practices",
});

await use_mcp_tool("get_webpage_content", {
  page_session_id: "abc123",
});
```

### Direct Search in VS Code

- **Command Palette**: `Bergamot: Search Webpages` - Semantic search
- **Hover over links**: View metadata for captured pages
- **Quick access**: Recent and frequently accessed pages
- **Filter metrics**: `Bergamot: Show Filter Metrics`
- **Visit outcomes**: `Bergamot: Show Visit Outcomes`
- **Replay a visit**: `Bergamot: Replay Visit`

## MCP Server Integration

Bergamot includes a built-in MCP (Model Context Protocol) server that exposes your browsing knowledge to AI agents. This enables powerful PKM workflows where AI assistants can access your captured web knowledge.

### Available MCP Tools

#### `semantic_search`

Search through your browsing history using natural language queries. Returns relevant webpages based on semantic similarity.

**Parameters:**

- `query` (string): Your search query in natural language
- `limit` (number, optional): Maximum results to return (default: 10)

**Returns:** List of relevant webpages with titles, URLs, summaries, and relevance scores

#### `get_webpage_content`

Retrieve the full markdown content of a specific webpage from your knowledge base.

**Parameters:**

- `page_session_id` (string): The unique ID of the webpage session

**Returns:** Full markdown content of the webpage

### Use Cases

- **Research Assistant**: AI agents can search your browsing history to find relevant information
- **Knowledge Synthesis**: Combine information from multiple captured pages
- **Citation Generation**: Automatically generate references from your browsing
- **Content Creation**: Use captured knowledge as context for writing
- **Learning Review**: Query past learning materials and documentation

## Development

This is a monorepo managed with npm workspaces and changesets.

### Setup

```bash
# Clone the repository
git clone https://github.com/bergamot/bergamot.git
cd bergamot

# Install dependencies
npm install

# Build all packages
npm run build
```

### Project Structure

```text
bergamot/
├── vscode/            # VS Code extension
├── browser/           # Browser extension
├── scripts/           # Shared scripts
├── docs/              # Documentation
├── backlog/           # Task management
└── .changeset/        # Version management
```

### Development Commands

```bash
# Run tests
npm test

# Lint code
npm run lint

# Build specific package
npm run build -w @bergamot/vscode

# Create a changeset
npm run changeset

# Version packages
npm run version

# Publish to npm
npm run release
```

### Testing the Extensions

**VS Code Extension:**

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. Test commands in the new VS Code window

**Browser Extension:**

```bash
cd browser
npm run chrome:debug  # Launches Chrome with extension loaded
```

## Configuration

### VS Code Settings

| Setting            | Description                                                          | Default |
| ------------------ | -------------------------------------------------------------------- | ------- |
| `bergamot.devMode` | Enable dev-phase observability (Bergamot Dev output + dev-log.jsonl) | `false` |

## Architecture

- **Capture**: deterministic and local — the raw page is stored losslessly with no model calls at ingest
- **Storage**: DuckDB for structured data and raw-page captures; LanceDB for vector embeddings
- **AI**: embeddings run locally (all-MiniLM-L6-v2) for retrieval over the stored raw page
- **Communication**: HTTP API between browser and VS Code
- **Protocols**: MCP for AI agent integration

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Reporting Issues

- Use the [issue tracker](https://github.com/bergamot/bergamot/issues)
- Include logs from Output > Bergamot
- Specify versions of VS Code and browser

## License

MIT © Bergamot Team

## Acknowledgments

- Uses [DuckDB](https://duckdb.org) and [LanceDB](https://lancedb.com)
- MCP integration via [Model Context Protocol](https://modelcontextprotocol.io)
