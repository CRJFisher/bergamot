import * as vscode from "vscode";
import { DuckDB } from "./duck_db";
import { get_webpage_by_url } from "./duck_db";
import { LanceDBMemoryStore } from "./lance_db";

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

interface WebpageMetadata {
  url: string;
  title: string;
  content: string;
  visited_at?: string;
}

export class WebpageHoverProvider implements vscode.HoverProvider {
  private cache: Map<string, WebpageMetadata | null> = new Map();

  constructor(
    private duck_db: DuckDB,
    private memory_store: LanceDBMemoryStore
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token?: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // Extract URL at the current position
    const url = this.extract_url_at_position(document, position);

    if (!url) {
      return undefined;
    }

    // Check cache first
    if (this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (cached === null) {
        return undefined; // Previously not found
      }
      return this.create_hover(cached);
    }

    try {
      // Look up webpage in database
      const webpage = await this.find_webpage_by_url(url);

      if (!webpage) {
        this.cache.set(url, null);
        return undefined;
      }

      // Cache the result
      this.cache.set(url, webpage);

      return this.create_hover(webpage);
    } catch (error) {
      console.error("Error providing hover:", error);
      return undefined;
    }
  }

  private extract_url_at_position(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | null {
    const line = document.lineAt(position.line);
    const text = line.text;

    // Look for markdown link pattern [text](url)
    const markdown_link_regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = markdown_link_regex.exec(text)) !== null) {
      const link_start = match.index + match[1].length + 3; // Start of URL
      const link_end = link_start + match[2].length;

      if (position.character >= link_start && position.character <= link_end) {
        return match[2];
      }
    }

    // Look for plain URLs
    const url_regex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

    while ((match = url_regex.exec(text)) !== null) {
      const url_start = match.index;
      const url_end = url_start + match[0].length;

      if (position.character >= url_start && position.character <= url_end) {
        return match[0];
      }
    }

    return null;
  }

  private async find_webpage_by_url(
    url: string
  ): Promise<WebpageMetadata | null> {
    try {
      // First try to find in DuckDB
      const webpage = await get_webpage_by_url(this.duck_db, url);

      if (webpage) {
        // Try to get additional content from memory store
        const memory_results = await this.memory_store.search(
          [WEBPAGE_CONTENT_NAMESPACE],
          { query: url, limit: 1 }
        );

        const content =
          memory_results.length > 0
            ? (
                memory_results[0] as unknown as {
                  value: { pageContent: string };
                }
              ).value.pageContent.substring(0, 500) + "..."
            : "Content not available";

        return {
          url: webpage.url,
          title: webpage.title || "Untitled",
          content: content,
          visited_at: webpage.visited_at,
        };
      }

      return null;
    } catch (error) {
      console.error("Error finding webpage:", error);
      return null;
    }
  }

  private create_hover(webpage: WebpageMetadata): vscode.Hover {
    const markdown = new vscode.MarkdownString();

    // Make it look nice
    markdown.supportHtml = true;
    markdown.isTrusted = true;

    // Title
    markdown.appendMarkdown(`### 📄 ${webpage.title}\n\n`);

    // URL
    markdown.appendMarkdown(`**URL:** ${webpage.url}\n\n`);

    // Visited date if available
    if (webpage.visited_at) {
      const date = new Date(webpage.visited_at);
      markdown.appendMarkdown(
        `**Visited:** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n\n`
      );
    }

    // Content preview
    markdown.appendMarkdown(`**Preview:**\n\n`);
    markdown.appendText(webpage.content);

    return new vscode.Hover(markdown);
  }

  public clear_cache(): void {
    this.cache.clear();
  }
}

export function register_webpage_hover_provider(
  context: vscode.ExtensionContext,
  duck_db: DuckDB,
  memory_store: LanceDBMemoryStore
): void {
  const hover_provider = new WebpageHoverProvider(duck_db, memory_store);

  // Register for markdown files
  const markdown_registration = vscode.languages.registerHoverProvider(
    { scheme: "file", language: "markdown" },
    hover_provider
  );

  // Register for plain text files
  const text_registration = vscode.languages.registerHoverProvider(
    { scheme: "file", language: "plaintext" },
    hover_provider
  );

  // Clear cache when configuration changes
  const config_change = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("bergamot")) {
      hover_provider.clear_cache();
    }
  });

  context.subscriptions.push(
    markdown_registration,
    text_registration,
    config_change
  );
}
