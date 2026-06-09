# Bergamot

> Privacy-first: turn your web browsing into a queryable knowledge base — capturing **metadata only, never page content** — accessible via MCP for AI-powered PKM workflows

## Why Bergamot?

Every day, you browse dozens of valuable webpages - documentation, tutorials, articles, and research. But this knowledge gets lost in browser history. Bergamot surfaces it without ever recording what's on your private pages:

1. **Metadata-Only Capture**: Records the trail of pages you visit (URL, title, timestamp, navigation graph) — never the page content
2. **Re-Download to Understand**: Re-fetches public pages later from their URLs; pages behind a login wall fail to fetch and are excluded automatically
3. **MCP Access**: Exposes the surfaced knowledge to AI agents for powerful PKM workflows
4. **Queryable**: AI agents browse the record through MCP tools — by URL, title, navigation tree, and re-downloaded content

The result? Your browsing becomes a searchable, local-only knowledge base that AI assistants can query — built from public pages you can actually re-fetch, with your private pages never stored.

## Overview

Bergamot captures the metadata of the pages you visit, stores that metadata locally as the durable source of truth, re-downloads the public pages during post-processing to understand them, and exposes the result through an MCP server for AI-powered knowledge management. Your private, logged-in pages are never recorded — the login wall is the filter.

### Core Components

- **Browser Extension** (`@bergamot/browser-extension`) - Captures the metadata and navigation graph of the pages you visit (never page content)
- **VS Code Extension** (`@bergamot/vscode`) - Re-downloads public pages, provides search, management, and the MCP server
- **MCP Server** - Exposes your surfaced browsing knowledge to AI agents for RAG queries and PKM workflows

## Key Features

### 🌐 Capture (metadata only)

- Records the trail of pages you visit: visit id, URL, title, page-load timestamp
- Preserves full navigation context and referrer chains (the session graph)
- **Never stores page content at capture** — title and URL come straight from the tab
- Never touches incognito/private tabs

### 🔒 Privacy

- **Page content is never captured.** Content is re-downloaded later from the public URL during post-processing
- **The login wall is the privacy filter**: authenticated and paywalled pages fail to re-download and are excluded automatically — no heuristic guessing
- **Local-only by default**; metadata syncs (if you enable it) only over your own devices, never a developer server
- **Right-to-forget**: forgetting is deletion, not hiding — `Bergamot: Forget` deletes by URL, origin, or time range, cascading across the metadata record and the encrypted content cache (derived vector/cluster stores join the cascade as they land)

### 💾 Store

- Persists each visit's **metadata** to DuckDB as the durable source of truth (there is no raw-content capture row)
- The metadata store is **encrypted at rest**; its key lives in your OS keystore (via VS Code SecretStorage). The database file alone is unreadable without that key — losing the key, or copying the file to another machine without it, means the data is unrecoverable. There is no recovery path (see [docs/threat-model.md](docs/threat-model.md))
- Any content cached after re-download is a separate, on-demand, encrypted, deletable tier

### 🔍 Query

- **MCP server** for AI agents — `get_webpage_content` (over re-downloaded public content) plus relational tools (visits, titles, navigation trees)
- **HTTP query API** for scripts (the extension's server owns the single DuckDB connection)

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
2. Browse normally — Bergamot automatically captures the metadata of the pages you visit
3. Public pages are re-downloaded from their URLs during post-processing; pages behind a login wall are skipped, and their content is never stored

### Accessing Your Knowledge via MCP

The MCP server enables AI agents to query your browsing knowledge:

```javascript
// Example: Using with Claude or other MCP-compatible agents
await use_mcp_tool("get_visit_by_url", {
  url: "https://react.dev/reference/react/hooks",
});

await use_mcp_tool("get_webpage_content", {
  page_session_id: "abc123",
});
```

### In VS Code

- **Hover over links**: View metadata for captured pages
- **Forget**: `Bergamot: Forget` — permanently delete visits by URL, origin, or time range, including all derived content
- **Visit outcomes**: `Bergamot: Show Visit Outcomes`
- **Replay a visit**: `Bergamot: Replay Visit`

## MCP Server Integration

Bergamot includes a built-in MCP (Model Context Protocol) server that exposes your browsing knowledge to AI agents. This enables powerful PKM workflows where AI assistants can access your captured web knowledge.

### Available MCP Tools

#### `get_webpage_content`

Retrieve the markdown content of a specific webpage, re-downloaded from its URL. Available only for public pages; content for login-walled, paywalled, or dead pages is unavailable by design, and a re-downloaded page may differ from the page as originally viewed.

**Parameters:**

- `page_session_id` (string): The unique ID of the webpage session

**Returns:** Markdown content of the re-downloaded webpage, or unavailable if the page could not be fetched

#### Relational tools

`get_visit_by_url`, `search_by_title`, `get_navigation_tree`, and `list_recent_navigation_trees` query the metadata record directly: visits by URL, captures by title, and navigation trees (cross-page browsing sessions) with their member pages.

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

- **Capture**: deterministic and local — metadata only, no page content and no model calls at ingest
- **Re-download**: public pages are re-fetched from their URLs during post-processing; the login wall filters out private pages
- **Storage**: DuckDB for the metadata store (the source of truth), encrypted at rest with a key held in the OS keystore; any content cache is encrypted and deletable
- **AI**: embeddings run locally (all-MiniLM-L6-v2) for retrieval over re-downloaded public content
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

- Uses [DuckDB](https://duckdb.org)
- MCP integration via [Model Context Protocol](https://modelcontextprotocol.io)
