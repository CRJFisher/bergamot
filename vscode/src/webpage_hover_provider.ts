import * as vscode from "vscode";
import { DuckDB, get_webpage_by_url } from "./duck_db";

interface WebpageMetadata {
  url: string;
  title: string;
  visited_at?: string;
}

/**
 * Shows a captured page's metadata (title, URL, last visit) when hovering a link
 * in a markdown/plaintext document. Content/preview is intentionally omitted:
 * page-content indexing is deferred to the RAG-prep pipeline (task-31), so this
 * reads only the cheap DuckDB capture record.
 */
export class WebpageHoverProvider implements vscode.HoverProvider {
  private cache: Map<string, WebpageMetadata | null> = new Map();

  constructor(private duck_db: DuckDB) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const url = this.extract_url_at_position(document, position);
    if (!url) {
      return undefined;
    }

    if (this.cache.has(url)) {
      const cached = this.cache.get(url);
      return cached ? this.create_hover(cached) : undefined;
    }

    try {
      const webpage = await this.find_webpage_by_url(url);
      this.cache.set(url, webpage);
      return webpage ? this.create_hover(webpage) : undefined;
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

    const markdown_link_regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = markdown_link_regex.exec(text)) !== null) {
      // Skip past `[text](` to reach the URL: 3 chars for `]`, `(`, and `[`.
      const link_start = match.index + match[1].length + 3;
      const link_end = link_start + match[2].length;

      if (position.character >= link_start && position.character <= link_end) {
        return match[2];
      }
    }

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
      const webpage = await get_webpage_by_url(this.duck_db, url);
      if (!webpage) return null;
      return {
        url: webpage.url,
        title: webpage.title || "Untitled",
        visited_at: webpage.visited_at,
      };
    } catch (error) {
      console.error("Error finding webpage:", error);
      return null;
    }
  }

  private create_hover(webpage: WebpageMetadata): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    markdown.supportHtml = true;
    markdown.isTrusted = true;

    markdown.appendMarkdown(`### 📄 ${webpage.title}\n\n`);
    markdown.appendMarkdown(`**URL:** ${webpage.url}\n\n`);

    if (webpage.visited_at) {
      const date = new Date(webpage.visited_at);
      markdown.appendMarkdown(
        `**Visited:** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n\n`
      );
    }

    return new vscode.Hover(markdown);
  }

  public clear_cache(): void {
    this.cache.clear();
  }
}

export function register_webpage_hover_provider(
  context: vscode.ExtensionContext,
  duck_db: DuckDB
): void {
  const hover_provider = new WebpageHoverProvider(duck_db);

  const markdown_registration = vscode.languages.registerHoverProvider(
    { scheme: "file", language: "markdown" },
    hover_provider
  );

  const text_registration = vscode.languages.registerHoverProvider(
    { scheme: "file", language: "plaintext" },
    hover_provider
  );

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
