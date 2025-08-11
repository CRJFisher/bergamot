# Mindsteep

> Steep knowledge from your web browsing patterns - A mindful approach to personal knowledge management

## Overview

Mindsteep is a comprehensive personal knowledge management system that helps you steep and extract knowledge from your web browsing patterns. Like brewing the perfect cup of tea, Mindsteep lets your web experiences steep into rich, accessible knowledge. It consists of:

- **VS Code Extension** (`@mindsteep/vscode`) - Manage your knowledge base, search captured content, and get AI-powered insights
- **Browser Extension** (`@mindsteep/browser-extension`) - Automatically capture and categorize webpages you visit

## Features

### 🌐 Smart Web Capture
- Automatically captures webpages you visit
- AI-powered content filtering (focuses on knowledge-rich content)
- Preserves navigation context and referrer chains
- Compressed storage for efficiency

### 🔍 Powerful Search & Retrieval
- Semantic search across all captured content
- Quick access via VS Code command palette
- Hover tooltips showing webpage metadata
- MCP (Model Context Protocol) integration for AI agents

### 🧠 Intelligent Filtering
- Machine learning-based page classification
- Customizable filtering rules
- Agent memory that learns from your feedback
- Review and correct filtering decisions

### 📊 Analytics & Insights
- Filter metrics and statistics
- Memory usage tracking
- Webpage relationship visualization

## Installation

### Prerequisites

- Node.js >= 18.0.0
- VS Code >= 1.60.0
- Chrome or Firefox browser

### Quick Start

1. **Install the VS Code Extension**
   ```bash
   # From VS Code
   ext install mindsteep.mindsteep
   ```

2. **Install the Browser Extension**
   - Chrome: [Chrome Web Store](#) (coming soon)
   - Firefox: [Firefox Add-ons](#) (coming soon)
   - Or build from source (see Development section)

3. **Configure OpenAI API Key**
   - Open VS Code settings
   - Search for "PKM Assistant"
   - Enter your OpenAI API key

## Usage

### Capturing Webpages

1. Install and activate the browser extension
2. Browse normally - pages are automatically captured
3. Knowledge-rich pages are processed and stored

### Searching Your Knowledge Base

- **Command Palette**: `PKM Assistant: Search Webpages`
- **Hover over links**: See metadata for captured pages
- **MCP Integration**: Use with AI agents for RAG queries

### Managing Filters

- **Review filtered pages**: `PKM Assistant: Generate Filtering Review`
- **Correct decisions**: Click correction links in the review document
- **View metrics**: `PKM Assistant: Show Filter Metrics`

## Development

This is a monorepo managed with npm workspaces and changesets.

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/pkm-assistant.git
cd pkm-assistant

# Install dependencies
npm install

# Build all packages
npm run build
```

### Project Structure

```
pkm-assistant/
├── packages/
│   ├── vscode/        # VS Code extension
│   └── browser/       # Browser extension
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
npm run build -w @pkm-assistant/vscode

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
cd packages/browser
npm run chrome:debug  # Launches Chrome with extension loaded
```

## Configuration

### VS Code Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `pkm-assistant.openaiApiKey` | Your OpenAI API key | - |
| `pkm-assistant.webpageFilter.enabled` | Enable AI filtering | `true` |
| `pkm-assistant.webpageFilter.allowedTypes` | Page types to capture | `["knowledge"]` |
| `pkm-assistant.webpageFilter.minConfidence` | Min confidence for classification | `0.7` |
| `pkm-assistant.agentMemory.enabled` | Enable learning from feedback | `true` |

## Architecture

- **Storage**: DuckDB for structured data, LanceDB for vector embeddings
- **AI**: OpenAI for content analysis and embeddings
- **Communication**: HTTP API between browser and VS Code
- **Protocols**: MCP for AI agent integration

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Reporting Issues

- Use the [issue tracker](https://github.com/your-username/pkm-assistant/issues)
- Include logs from Output > PKM Assistant
- Specify versions of VS Code and browser

## License

MIT © PKM Assistant Team

## Acknowledgments

- Built with [LangChain](https://github.com/langchain-ai/langchain) and [OpenAI](https://openai.com)
- Uses [DuckDB](https://duckdb.org) and [LanceDB](https://lancedb.com)
- MCP integration via [Model Context Protocol](https://modelcontextprotocol.io)