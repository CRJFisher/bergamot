import * as vscode from "vscode";
import { LanceDBMemoryStore } from "./lance_db";

const WEBPAGE_CONTENT_NAMESPACE = "webpage_content";

interface WebpageSearchResult {
  id: string;
  url: string;
  title: string;
  preview: string;
  score?: number;
}

export function register_webpage_search_commands(
  context: vscode.ExtensionContext,
  memory_store: LanceDBMemoryStore
): void {
  // Command to search webpages
  const search_webpages_command = vscode.commands.registerCommand(
    "mindsteep.searchWebpages",
    async () => {
      // Get search query from user
      const query = await vscode.window.showInputBox({
        prompt: "Search for webpages",
        placeHolder: "Enter search terms...",
        validateInput: (value) => {
          if (!value || value.trim().length < 2) {
            return "Please enter at least 2 characters";
          }
          return null;
        },
      });

      if (!query) {
        return;
      }

      // Show progress while searching
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Searching webpages...",
          cancellable: false,
        },
        async () => {
          try {
            // Search in memory store
            const search_results = await memory_store.search(
              [WEBPAGE_CONTENT_NAMESPACE],
              { query, limit: 20 }
            );

            if (search_results.length === 0) {
              vscode.window.showInformationMessage(
                "No webpages found matching your search."
              );
              return;
            }

            // Format results for quick pick
            const quick_pick_items: vscode.QuickPickItem[] = search_results.map(
              (result) => {
                const value = result as unknown as {
                  value: { title: string; url: string; pageContent: string };
                  key: string;
                  score?: number;
                };
                return {
                  label: value.value.title || "Untitled",
                  description: value.value.url,
                  detail: value.value.pageContent.substring(0, 150) + "...",
                  // Store the full result in a property for later use
                  result: {
                    id: value.key,
                    url: value.value.url,
                    title: value.value.title,
                    preview: value.value.pageContent.substring(0, 200),
                    score: value.score || 0,
                  } as WebpageSearchResult,
                } as vscode.QuickPickItem & { result: WebpageSearchResult };
              }
            );

            // Show quick pick
            const selected = (await vscode.window.showQuickPick(
              quick_pick_items,
              {
                placeHolder: "Select a webpage to add to document",
                matchOnDescription: true,
                matchOnDetail: true,
              }
            )) as
              | (vscode.QuickPickItem & { result: WebpageSearchResult })
              | undefined;

            if (!selected) {
              return;
            }

            // Add selected webpage to current document
            await add_webpage_to_document(selected.result);
          } catch (error) {
            vscode.window.showErrorMessage(`Search failed: ${error.message}`);
          }
        }
      );
    }
  );

  context.subscriptions.push(search_webpages_command);
}

async function add_webpage_to_document(
  webpage: WebpageSearchResult
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("No active text editor found");
    return;
  }

  // Format the webpage reference
  const formatted_reference = format_webpage_reference(webpage);

  // Insert at current cursor position
  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, formatted_reference);
  });

  vscode.window.showInformationMessage("Webpage reference added to document");
}

function format_webpage_reference(webpage: WebpageSearchResult): string {
  // Format as a markdown link with metadata
  return `\n[${webpage.title}](${webpage.url})\n`;
}
