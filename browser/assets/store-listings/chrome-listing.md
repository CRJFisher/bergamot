# Chrome Web Store Listing

## Extension Name

Bergamot — Browsing Knowledge Base

## Short Description (132 characters max)

Privacy-first: captures the trail of pages you visit (metadata only, never page content). Local-only, with VS Code integration.

## Detailed Description

### Overview

Bergamot turns your everyday browsing into a private, queryable knowledge base. It captures the _trail_ of the pages you visit — their URL, title, timestamp, and how you navigated between them — and never records the content of those pages. Everything stays on your own machine.

### Privacy First

- **Metadata only, never content**: Bergamot records the trail of each visit (URL, title, page-load timestamp, navigation graph). It never captures or stores the content of the pages you view.
- **Private pages stay private**: Page content is re-downloaded later only from public URLs. Pages behind a login wall fail to re-download and are excluded automatically — the login wall is the privacy filter, so your authenticated and paywalled pages are never recorded.
- **Incognito is never touched**: Private-browsing tabs are refused before any capture happens — not even their metadata is recorded.
- **Local-only**: Your data lives on your device. Nothing is sent to a developer-controlled server.
- **Right to forget**: Delete by URL, origin, or time range, cascading across every derived artifact.
- **Visible and stoppable**: An always-on capture indicator and a one-click global pause/kill put you in control.

### Key Features

- **Navigation & referrer-chain tracking**: Captures referrer chains, tab-opener relationships, and SPA navigation events to preserve the full path you took.
- **Tab & session graph**: Records tab relationships, groups, and sessions so the structure of your browsing is preserved.
- **VS Code integration over local HTTP**: Connects to the Bergamot VS Code extension through a local HTTP API on your own machine.
- **Semantic search**: Through the VS Code extension, search your browsing knowledge in natural language over re-downloaded public content.

### How It Works

1. Install the extension in your browser.
2. Browse normally — Bergamot captures the metadata and navigation graph of the pages you visit, never their content.
3. The Bergamot VS Code extension re-downloads the public pages from their URLs to understand them, builds a local searchable index, and exposes it for semantic search and AI-powered knowledge workflows. Login-walled pages are skipped and never stored.

### Use Cases

- **Research**: Rebuild the trail of sources behind a piece of work.
- **Learning**: Revisit the documentation and tutorials you worked through.
- **Content creation**: Recall references and inspiration from public pages you read.
- **Professional development**: Track technical documentation and learning resources you visited.

### Privacy & Security

- Page content is never captured — only re-downloaded later from public URLs.
- All storage and processing happens locally on your device.
- Open source and auditable.
- No third-party tracking or analytics.

### Requirements

- A Chromium-based browser (Chrome, Edge, or Brave), version 88 or later.
- For full features: VS Code with the Bergamot extension.

### Support

- GitHub: https://github.com/bergamot/bergamot
- Documentation: [Link to docs]
- Report Issues: [Link to issues]

## Category

Productivity

## Language

English

## Tags (5 maximum)

- knowledge management
- privacy
- productivity
- research
- browsing history
