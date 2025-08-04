// import * as vscode from "vscode";
// import { NoteTools } from "./note_tools";
// import { Note } from "./model_schema";
// import { MarkdownDatabase, notesSpec } from "./markdown_db";

// const SUGGESTIONS_DOC_PATH = "/Users/chuck/workspace/pkm/Tasks/Front Page.md";
// const WEBPAGES_HEADER = "## Visited Webpages";
// const PROPOSALS_HEADER = "## Note Proposals";

// export async function setup_decorations(
//   context: vscode.ExtensionContext,
//   markdown_db: MarkdownDatabase
// ): Promise<void> {
//   // Create a decoration type for the highlight
//   const highlightDecorationType = vscode.window.createTextEditorDecorationType({
//     after: {
//       margin: "0 0 0 1em",
//       textDecoration: "none",
//       backgroundColor: "rgba(255, 255, 0, 0.1)",
//       // border: "1px solid #ffd700",
//       color: "#000000",
//     },
//     rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
//   });

//   // Track the current hover
//   let currentHoverDisposable: vscode.Disposable | undefined;

//   // Function to update decorations
//   function updateDecorations(editor: vscode.TextEditor) {
//     // Only process the specific file
//     if (editor.document.uri.fsPath !== SUGGESTIONS_DOC_PATH) {
//       return;
//     }

//     const text = editor.document.getText();
//     const decorations: vscode.DecorationOptions[] = [];

//     // Find the Visited Webpages section
//     const webpages_index = text.indexOf(WEBPAGES_HEADER);
//     if (webpages_index !== -1) {
//       add_webpage_categorisation_decorations(
//         text,
//         webpages_index,
//         editor,
//         decorations
//       );
//     }

//     // Find the Note Proposals section
//     const proposals_index = text.indexOf(PROPOSALS_HEADER);
//     if (proposals_index !== -1) {
//       add_note_proposal_decorations(text, proposals_index, editor, decorations);
//     }

//     editor.setDecorations(highlightDecorationType, decorations);
//   }

//   // Helper functions for handling actions
//   function handle_wiki_link_actions(
//     editor: vscode.TextEditor,
//     position: vscode.Position,
//     suggestion_text: string
//   ) {
//     vscode.window
//       .showQuickPick([
//         {
//           label: "Add to Note",
//           description: "Add this link to an existing note",
//           detail: suggestion_text,
//         },
//         {
//           label: "Give Feedback",
//           description: "Provide feedback about this suggestion",
//           detail: suggestion_text,
//         },
//         {
//           label: "Delete",
//           description: "Remove this suggestion",
//           detail: suggestion_text,
//         },
//       ])
//       .then((selection) => {
//         if (selection) {
//           switch (selection.label) {
//             case "Add to Note":
//               {
//                 NoteTools.fetch_existing_notes().then((existing_notes) => {
//                   const note = existing_notes.find(
//                     (note) => note.name === suggestion_text
//                   );
//                   add_link_to_note(note, editor, position, suggestion_text);
//                   delete_line_at_position(editor, position);
//                 });
//               }
//               break;
//             case "Give Feedback":
//               // Show input box for feedback
//               vscode.window
//                 .showInputBox({
//                   prompt: "Enter your feedback",
//                   placeHolder:
//                     "What feedback do you have about this suggestion?",
//                 })
//                 .then((feedback) => {
//                   if (feedback) {
//                     vscode.window.showInformationMessage(
//                       `Feedback received: ${feedback}`
//                     );
//                     // TODO: Handle the feedback
//                   }
//                 });
//               break;
//             case "Delete":
//               delete_line_at_position(editor, position);
//               break;
//           }
//         }
//       });
//   }

//   function handle_note_proposal_actions(
//     editor: vscode.TextEditor,
//     position: vscode.Position,
//     suggestion_text: string
//   ) {
//     vscode.window
//       .showQuickPick([
//         {
//           label: "Create Note",
//           description: "Create a new note with this title",
//           detail: suggestion_text,
//         },
//         {
//           label: "Delete",
//           description: "Remove this suggestion",
//           detail: suggestion_text,
//         },
//       ])
//       .then((selection) => {
//         if (selection) {
//           switch (selection.label) {
//             case "Create Note":
//               // Create a new note with the title
//               {
//                 markdown_db.findAll(notesSpec).then((notes) => {
//                   const match = notes.find((n) => n.name === suggestion_text);
//                   if (!match) {
//                     vscode.window.showErrorMessage(
//                       `Note ${suggestion_text} not found`
//                     );
//                     return;
//                   }
//                   const file_name = match.name + ".md";
//                   const link_string = match.webpages
//                     .map((u) => `- [${u}](${match.webpage_to_url_map[u]})`)
//                     .join("\n");

//                   // Create content for the file
//                   const content = `# ${match.name}\n\n${match.description}\n\n## Links\n\n${link_string}\n`;

//                   // Create the file path
//                   const file_path = vscode.Uri.file(
//                     vscode.workspace.workspaceFolders?.[0].uri.fsPath +
//                       "/" +
//                       file_name
//                   );

//                   // Write the file first
//                   vscode.workspace.fs
//                     .writeFile(file_path, Buffer.from(content))
//                     .then(() => {
//                       // Then open it for viewing
//                       vscode.workspace
//                         .openTextDocument(file_path)
//                         .then((doc) => {
//                           vscode.window.showTextDocument(doc);
//                           vscode.window.showInformationMessage(
//                             `Created note: ${file_name}`
//                           );
//                         });
//                     });
//                 });
//                 delete_proposal_at_position(position, editor);
//               }
//               break;
//             case "Delete":
//               // Remove the proposal
//               delete_proposal_at_position(position, editor);
//               break;
//           }
//         }
//       });
//   }

//   // Register mouse tracking to help manage hovers and handle clicks
//   const mouseTracker = vscode.window.onDidChangeTextEditorSelection((event) => {
//     if (currentHoverDisposable) {
//       currentHoverDisposable.dispose();
//       currentHoverDisposable = undefined;
//     }

//     // Handle clicks on decorations
//     const editor = event.textEditor;
//     if (editor && editor.document.uri.fsPath === SUGGESTIONS_DOC_PATH) {
//       const position = event.selections[0].active;
//       const line = editor.document.lineAt(position.line);
//       const line_text = line.text.trim();

//       // Only trigger on clicks (empty selection) and when clicking on the decoration icon
//       // The decoration icon is exactly 1 character wide
//       const line_length = line.text.length;
//       if (
//         position.character === line_length &&
//         event.selections[0].isEmpty &&
//         event.kind === vscode.TextEditorSelectionChangeKind.Mouse
//       ) {
//         // Check if it's a wiki link line or a subheading
//         const is_wiki_link = /^([ \t]*)- \[\[(.+?)\]\].*$/.test(line_text);
//         const is_subheading = /^###\s+(.+)$/.test(line_text);

//         if (!is_wiki_link && !is_subheading) {
//           return; // Skip if not a decorated line
//         }

//         // Extract the suggestion text
//         let suggestion_text = line_text;
//         if (is_wiki_link) {
//           // For wiki link, extract the link text
//           const wiki_match = line_text.match(/^(?:[ \t]*)- \[\[(.+?)\]\]/);
//           suggestion_text = wiki_match ? wiki_match[1] : line_text;
//         } else if (is_subheading) {
//           // For subheading, remove the ### prefix
//           suggestion_text = line_text.replace(/^###\s+/, "");
//         }

//         // Show the appropriate actions based on the type
//         if (is_wiki_link) {
//           handle_wiki_link_actions(editor, position, suggestion_text);
//         } else if (is_subheading) {
//           handle_note_proposal_actions(editor, position, suggestion_text);
//         }
//       }
//     }
//   });

//   context.subscriptions.push(mouseTracker);

//   // Update decorations when the active editor changes
//   let activeEditor = vscode.window.activeTextEditor;
//   if (activeEditor) {
//     updateDecorations(activeEditor);
//   }

//   vscode.window.onDidChangeActiveTextEditor(
//     (editor) => {
//       activeEditor = editor;
//       if (editor) {
//         updateDecorations(editor);
//       }
//     },
//     null,
//     context.subscriptions
//   );

//   // Update decorations when the document changes
//   vscode.workspace.onDidChangeTextDocument(
//     (event) => {
//       if (activeEditor && event.document === activeEditor.document) {
//         updateDecorations(activeEditor);
//       }
//     },
//     null,
//     context.subscriptions
//   );

//   // Register the command handler
//   context.subscriptions.push(
//     vscode.commands.registerCommand("pkm-assistant.addHighlight", () => {
//       // TODO: this won't work if proposed notes have wikilinks
//       const editor = vscode.window.activeTextEditor;
//       if (editor) {
//         const line = editor.document.lineAt(editor.selection.active.line);
//         const line_text = line.text.trim();

//         // Check if it's a wiki link line or a subheading
//         const is_wiki_link = /^([ \t]*)- \[\[(.+?)\]\].*$/.test(line_text);
//         const is_subheading = /^###\s+(.+)$/.test(line_text);

//         if (!is_wiki_link && !is_subheading) {
//           return; // Skip if not a decorated line
//         }

//         // Extract the suggestion text
//         let suggestion_text = line_text;
//         if (is_wiki_link) {
//           // For wiki link, extract the link text
//           const wiki_match = line_text.match(/^(?:[ \t]*)- \[\[(.+?)\]\]/);
//           suggestion_text = wiki_match ? wiki_match[1] : line_text;
//         } else if (is_subheading) {
//           // For subheading, remove the ### prefix
//           suggestion_text = line_text.replace(/^###\s+/, "");
//         }

//         // Show the appropriate actions based on the type
//         if (is_wiki_link) {
//           handle_wiki_link_actions(
//             editor,
//             editor.selection.active,
//             suggestion_text
//           );
//         } else if (is_subheading) {
//           handle_note_proposal_actions(
//             editor,
//             editor.selection.active,
//             suggestion_text
//           );
//         }
//       }
//     })
//   );
// }

// function delete_proposal_at_position(
//   position: vscode.Position,
//   editor: vscode.TextEditor
// ) {
//   const start_line = position.line;
//   let end_line = editor.document.lineCount;

//   // Search for the end boundary (next ### or ## or end of file)
//   for (let i = start_line + 1; i < editor.document.lineCount; i++) {
//     const line_text = editor.document.lineAt(i).text;
//     if (line_text.startsWith("###") || line_text.startsWith("##")) {
//       end_line = i;
//       break;
//     }
//   }

//   // Delete the range between start and end
//   editor.edit((edit_builder) => {
//     const delete_range = new vscode.Range(
//       new vscode.Position(start_line, 0),
//       new vscode.Position(end_line, 0)
//     );
//     edit_builder.delete(delete_range);
//   });
// }

// function delete_line_at_position(
//   editor: vscode.TextEditor,
//   position: vscode.Position
// ): void {
//   editor.edit((editBuilder) => {
//     const line_range = new vscode.Range(
//       new vscode.Position(position.line, 0),
//       new vscode.Position(position.line + 1, 0)
//     );
//     editBuilder.delete(line_range);
//   });
// }

// function add_link_to_note(
//   note: Note,
//   editor: vscode.TextEditor,
//   position: vscode.Position,
//   suggestion_text: string
// ) {
//   if (note) {
//     // Find the entire suggestion block by searching upwards for the title link
//     let title_link = "";

//     // Start from current line and search upwards for title-link pattern
//     let current_line = position.line;
//     while (current_line >= 0) {
//       const line_text = editor.document.lineAt(current_line).text;

//       // Look for title-link pattern like [Title](URL)
//       const title_link_match = line_text.match(/- \[(.*?)\]\((.*?)\)/);
//       if (title_link_match) {
//         title_link = `[${title_link_match[1]}](${title_link_match[2]})`;
//         break;
//       }
//       current_line--;
//     }

//     // Add the extracted information to the note
//     if (title_link) {
//       // Create a formatted entry for the note
//       const note_addition = `\n- ${title_link}`;

//       // Update the note
//       const edit = new vscode.WorkspaceEdit();
//       vscode.workspace.openTextDocument(note.path).then((doc) => {
//         const position = new vscode.Position(doc.lineCount, 0);
//         edit.insert(vscode.Uri.file(note.path), position, note_addition);
//         vscode.workspace.applyEdit(edit).then((success) => {
//           if (success) {
//             vscode.window.showInformationMessage(`Added to note: ${note.name}`);
//             vscode.window.showTextDocument(doc);
//           } else {
//             vscode.window.showErrorMessage("Failed to add to note");
//           }
//         });
//       });
//     } else {
//       vscode.window.showErrorMessage("Could not find title link information");
//     }
//   } else {
//     vscode.window.showErrorMessage(`Note ${suggestion_text} not found`);
//   }
// }

// function add_webpage_categorisation_decorations(
//   text: string,
//   section_index: number,
//   editor: vscode.TextEditor,
//   decorations: vscode.DecorationOptions[]
// ) {
//   let section_end = text.indexOf("\n## ", section_index + 1);
//   if (section_end === -1) {
//     section_end = text.length;
//   }

//   // Get the content of the Visited Webpages section
//   const section_content = text.slice(section_index, section_end);

//   // Find all indented wiki-links in the notes sections
//   // This pattern matches indented lines with wiki-links [[...]] within the section
//   const all_wiki_links_regex = /^([ \t]*)- \[\[(.+?)\]\].*$/gm;

//   let match;
//   while ((match = all_wiki_links_regex.exec(section_content))) {
//     // Calculate the absolute position in the document
//     const absolute_index = section_index + match.index;
//     const start_pos = editor.document.positionAt(absolute_index);
//     const end_pos = editor.document.positionAt(
//       absolute_index + match[0].length
//     );
//     const range = new vscode.Range(start_pos, end_pos);

//     const decoration: vscode.DecorationOptions = {
//       range,
//       renderOptions: {
//         after: {
//           contentText: "🔍",
//           color: "#000000",
//         },
//       },
//       hoverMessage: new vscode.MarkdownString(
//         `[Click to view options](command:pkm-assistant.addHighlight)`
//       ).appendMarkdown(
//         "\n\nClick the 🔍 icon to view options for this wiki link (Add to Note, Give Feedback, Delete)."
//       ),
//     };

//     decorations.push(decoration);
//   }
// }

// function add_note_proposal_decorations(
//   text: string,
//   section_index: number,
//   editor: vscode.TextEditor,
//   decorations: vscode.DecorationOptions[]
// ) {
//   let section_end = text.indexOf("\n## ", section_index + 1);
//   if (section_end === -1) {
//     section_end = text.length;
//   }

//   // Get the content of the Note Proposals section
//   const section_content = text.slice(section_index, section_end);

//   // Find subheadings (### lines) within the Note Proposals section
//   const subheading_regex = /^(###\s+.+)$/gm;
//   let match;

//   while ((match = subheading_regex.exec(section_content))) {
//     // Calculate the absolute position in the document
//     const absolute_index = section_index + match.index;
//     const start_pos = editor.document.positionAt(absolute_index);
//     const end_pos = editor.document.positionAt(
//       absolute_index + match[0].length
//     );
//     const range = new vscode.Range(start_pos, end_pos);

//     const decoration: vscode.DecorationOptions = {
//       range,
//       renderOptions: {
//         after: {
//           contentText: "🔍",
//           color: "#000000",
//         },
//       },
//       hoverMessage: new vscode.MarkdownString(
//         `[Click to view options](command:pkm-assistant.addHighlight)`
//       ).appendMarkdown(
//         "\n\nClick the 🔍 icon to view options for this note proposal (Create Note, Delete)."
//       ),
//     };

//     decorations.push(decoration);
//   }
// }
