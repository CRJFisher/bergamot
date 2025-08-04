import * as vscode from "vscode";
// import { DuckDB, get_webpages_for_note } from "./duck_db";
// import { WebpageCategorisationAndMetadata } from "./model_schema";
// import { MarkdownDatabase, suggestionsSpec } from "./markdown_db";

/**
 * Represents a custom CodeLens provider for showing action buttons at the top of files
 */
// class PKMCodeLensProvider implements vscode.CodeLensProvider {
//   private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
//     new vscode.EventEmitter<void>();
//   public readonly onDidChangeCodeLenses: vscode.Event<void> =
//     this._onDidChangeCodeLenses.event;
//   private duck_db: DuckDB;

//   constructor(duck_db: DuckDB) {
//     this.duck_db = duck_db;
//   }
//   // Register the provider for all file types

//   /**
//    * Refresh code lenses when needed
//    */
//   public refresh(): void {
//     this._onDidChangeCodeLenses.fire();
//   }

//   /**
//    * Provide code lenses for the given document
//    */
//   public async provideCodeLenses(
//     document: vscode.TextDocument,
//     token: vscode.CancellationToken
//   ): Promise<vscode.CodeLens[]> {
//     if (token.isCancellationRequested) return [];

//     // Create a position for the first line of the document
//     const position = new vscode.Position(0, 0);
//     const range = new vscode.Range(position, position);

//     // Get the recommended webpages for this document
//     const note_webpages = await get_webpages_for_note(
//       this.duck_db,
//       document.uri.fsPath
//     );
//     if (note_webpages.length === 0) {
//       return [];
//     }

//     // TODO: find the webpages already in the document
//     const document_text = document.getText();
//     const webpages_not_in_document = note_webpages.filter(
//       (webpage) => !document_text.includes(webpage.webpage_name)
//     );
//     if (webpages_not_in_document.length == 0) {
//       return [];
//     }

//     const heading = "## Related Webpages";

//     // Create code lenses with commands
//     const codeLenses: vscode.CodeLens[] = [
//       new vscode.CodeLens(range, {
//         title: `ADD ${webpages_not_in_document.length} WEBPAGES TO NOTES   📝`,
//         command: "pkm-assistant.addToNotes",
//         tooltip: "Add this content to your PKM notes",
//         arguments: [webpages_not_in_document, document.uri, heading],
//       }),
//       //   new vscode.CodeLens(range, {
//       //     title: "FIND RELATED NOTES   🔍",
//       //     command: "pkm-assistant.findRelatedNotes",
//       //     tooltip: "Find notes related to this content",
//       //     arguments: [document.uri],
//       //   }),
//     ];

//     return codeLenses;
//   }
// }

// /**
//  * Register commands for the code lens actions
//  */
// // function registerCommands(context: vscode.ExtensionContext): void {
// //   // Command for adding to notes
// //   context.subscriptions.push(
// //     vscode.commands.registerCommand(
// //       "pkm-assistant.addToNotes",
// //       async (
// //         webpage_categorisations: WebpageCategorisationAndMetadata[],
// //         document: vscode.Uri,
// //         heading: string
// //       ) => {
// //         // If heading doesn't exist, create it
// //         const editor = vscode.window.activeTextEditor;
// //         if (editor) {
// //           const document = editor.document;
// //           const documentText = document.getText();

// //           // Check if heading already exists
// //           if (!documentText.includes(heading)) {
// //             // Add the heading at the end of the document
// //             const position = new vscode.Position(document.lineCount, 0);
// //             const edit = new vscode.WorkspaceEdit();

// //             // Add two newlines before the heading for better formatting
// //             edit.insert(document.uri, position, `\n\n${heading}\n`);
// //             await vscode.workspace.applyEdit(edit);
// //           }
// //         }
// //         const markdown_db = new MarkdownDatabase(document.fsPath);
// //         await markdown_db.insert_all(
// //           suggestionsSpec,
// //           webpage_categorisations,
// //           heading,
// //           ["notes"]
// //         );
// //         await markdown_db.save();
// //       }
// //     )
// //   );
// // }

// /**
//  * Setup file navigation and editor activation triggers
//  */
// function setupEventTriggers(
//   context: vscode.ExtensionContext,
//   provider: PKMCodeLensProvider
// ): void {
//   // Refresh code lenses when active editor changes
//   context.subscriptions.push(
//     vscode.window.onDidChangeActiveTextEditor((editor) => {
//       if (editor) {
//         provider.refresh();
//       }
//     })
//   );

//   // Refresh code lenses when window state changes (becomes active)
//   context.subscriptions.push(
//     vscode.window.onDidChangeWindowState((windowState) => {
//       if (windowState.focused) {
//         provider.refresh();
//       }
//     })
//   );
// }

// /**
//  * Setup code lens decorations for all supported files
//  */
// export function setup_code_lens_decorations(
//   context: vscode.ExtensionContext,
//   duck_db: DuckDB
// ): void {
//   // Create the code lens provider
//   const codeLensProvider = new PKMCodeLensProvider(duck_db);

//   // Register the provider for all file types
//   const selector: vscode.DocumentSelector = { scheme: "file" };

//   // Register the provider
//   context.subscriptions.push(
//     vscode.languages.registerCodeLensProvider(selector, codeLensProvider)
//   );

//   // Register commands for code lens actions
//   // registerCommands(context);

//   // Setup event triggers
//   setupEventTriggers(context, codeLensProvider);

//   console.log("PKM Assistant code lens decorations are active");
// }
