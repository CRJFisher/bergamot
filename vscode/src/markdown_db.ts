import { promises as fs } from "fs";
import { dirname } from "path";
import * as vscode from "vscode";
import { z } from "zod";
import { NoteSchema } from "./model_schema";
import { WebpageTreeNode, WebpageTreeNodeSchema } from "./webpage_tree_models";

/**
 * Result of extracting a section from markdown content.
 * Each section span includes its own trailing blank lines.
 * 
 * @interface SectionExtraction
 */
export interface SectionExtraction {
  /** Line number where the section starts (-1 if not found) */
  start: number;
  /** Line number after the end of the section (exclusive) */
  end_exclusive: number;
  /** Content blocks within the section, each block is an array of lines */
  blocks: string[][];
}

/**
 * Specification for a typed collection within a markdown database.
 * Defines how to serialize, deserialize, and manipulate typed data in markdown sections.
 * 
 * @template T - The TypeScript type of items stored in this collection
 * @interface CollectionSpec
 */
export interface CollectionSpec<T> {
  /** Whether to insert a blank line between content blocks */
  addEmptyLineBetweenBlocks: boolean;
  /** Whether to add an empty line at the end of all blocks */
  addAnEmptyLineAtEndOfBlocks: boolean;
  /** Zod schema for runtime validation and type safety */
  schema: z.ZodSchema<T>;
  /** Serializes one typed record back to an array of markdown lines */
  toMarkdown(t: T): string[];
  /** Extracts section content from markdown and splits into logical blocks */
  extractSection(content: string, heading: string): SectionExtraction;
  /**
   * Optional: Determines if a typed object matches an existing markdown block.
   * If not provided, falls back to exact string matching between serialized forms.
   * 
   * @param obj - The typed object to check for a match
   * @param existingBlock - Array of markdown lines representing an existing block
   * @returns True if the object matches the existing block
   */
  matchesExistingBlock?(obj: T, existingBlock: string[]): boolean;
}

/**
 * Collection spec for WebpageTreeNode that matches the format from webpage_tree_to_md_string
 */
export const WebpageTreeNodeCollectionSpec: CollectionSpec<WebpageTreeNode> = {
  addEmptyLineBetweenBlocks: true,
  addAnEmptyLineAtEndOfBlocks: true,
  schema: WebpageTreeNodeSchema,

  toMarkdown: (node: WebpageTreeNode): string[] => {
    const lines: string[] = [];
    const session = node.webpage_session;

    // Add the main node line with title, URL, and timestamp
    const timestamp = session.page_loaded_at.slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM format
    lines.push(
      `- [${session.analysis?.title || "Untitled"}](${
        session.url
      }) [${timestamp}]`
    );

    // Add referrer if available
    if (session.referrer) {
      lines.push(`  - Referrer: ${session.referrer}`);
    }

    // Add summary if available
    if (session.analysis?.summary) {
      lines.push(`  - Summary: ${session.analysis.summary}`);
    }

    // Add intentions if available
    if (session.tree_intentions) {
      lines.push(`  - Intentions: ${session.tree_intentions.join("; ")}`);
    } else if (session.analysis?.intentions) {
      lines.push(
        `  - Intentions (new page): ${session.analysis.intentions.join("; ")}`
      );
    }

    // Recursively add children
    if (node.children) {
      for (const child of node.children) {
        const child_lines = WebpageTreeNodeCollectionSpec.toMarkdown(child);
        lines.push(...child_lines);
      }
    }

    return lines;
  },

  matchesExistingBlock: (
    node: WebpageTreeNode,
    existingBlock: string[]
  ): boolean => {
    // Get the markdown representation of the new node
    const node_markdown = WebpageTreeNodeCollectionSpec.toMarkdown(node);

    // Simply compare the entire first line (title, URL, and timestamp)
    if (existingBlock.length === 0 || node_markdown.length === 0) {
      return false;
    }

    const node_first_line = node_markdown[0];
    const existing_first_line = existingBlock[0];

    return node_first_line === existing_first_line;
  },

  extractSection: (content: string, heading: string): SectionExtraction => {
    const lines = content.split("\n");
    let start = -1;
    let end = lines.length;
    let current_block: string[] = [];
    const blocks: string[][] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === heading) {
        if (start === -1) {
          start = i + 1; // Start AFTER the heading line, not at it
        } else {
          // We found the next heading, end the current section
          if (current_block.length > 0) {
            blocks.push(current_block);
            current_block = [];
          }
          end = i;
          break;
        }
      } else if (start !== -1) {
        if (line.trim() === "") {
          if (current_block.length > 0) {
            blocks.push(current_block);
            current_block = [];
          }
        } else {
          current_block.push(line);
        }
      }
    }

    // Don't forget the last block
    if (current_block.length > 0) {
      blocks.push(current_block);
    }

    return { start, end_exclusive: end, blocks };
  },
};

/**
 * A lightweight NoSQL database that uses markdown files as the storage engine.
 * Provides typed CRUD operations on structured data stored in markdown sections.
 * Supports both VSCode TextDocument integration and direct file system access.
 * 
 * @example
 * ```typescript
 * // Create database instance
 * const db = new MarkdownDatabase('/path/to/notes.md');
 * 
 * // Insert a note
 * await db.insert(notesSpec, {
 *   name: 'My Note',
 *   sections: ['personal', 'ideas'],
 *   description: 'Ideas about the project'
 * }, '## Notes');
 * 
 * // Save changes
 * await db.save();
 * ```
 */
export class MarkdownDatabase {
  private textDoc: vscode.TextDocument | null = null;
  private content = "";
  constructor(private readonly path: string) {}

  /**
   * Returns the absolute path to a file in the same directory as the database.
   * Useful for creating related files alongside the main markdown database file.
   * 
   * @param filename - Name of the file to get the path for
   * @returns Absolute path to the file in the database directory
   * 
   * @example
   * ```typescript
   * const db = new MarkdownDatabase('/notes/main.md');
   * const configPath = db.get_file_path('config.json'); // '/notes/config.json'
   * ```
   */
  get_file_path(filename: string): string {
    // Return the path to a file in the same directory as the database
    const dir = dirname(this.path);
    return `${dir}/${filename}`;
  }

  private async load(): Promise<void> {
    if (this.textDoc) {
      this.content = this.textDoc.getText();
    } else {
      this.content = await fs.readFile(this.path, "utf8");
    }
  }

  /**
   * Saves the current database content to disk.
   * Uses VSCode workspace edit if operating on an open document, otherwise writes directly to file.
   * 
   * @returns Promise that resolves when save is complete
   * @throws {Error} If file write or workspace edit fails
   * 
   * @example
   * ```typescript
   * await db.insert(notesSpec, newNote, '## Notes');
   * await db.save(); // Persist changes to disk
   * ```
   */
  async save(): Promise<void> {
    if (this.textDoc) {
      const edit = new vscode.WorkspaceEdit();
      const full = new vscode.Range(
        this.textDoc.positionAt(0),
        this.textDoc.positionAt(this.textDoc.getText().length)
      );
      edit.replace(this.textDoc.uri, full, this.content);
      await vscode.workspace.applyEdit(edit);
    } else {
      await fs.mkdir(dirname(this.path), { recursive: true });
      await fs.writeFile(this.path, this.content);
    }
  }

  // ────────────────────────────────────────────────────────── public API ──
  
  /**
   * Inserts a single typed record into the specified markdown section.
   * The record is validated against the collection spec's schema before insertion.
   * 
   * @template T - Type of the record to insert
   * @param spec - Collection specification defining how to handle this type
   * @param data - The typed data to insert
   * @param heading - Markdown heading that defines the target section (e.g., '## Notes')
   * @param add_at_start - Whether to add the record at the start or end of the section (default: true)
   * @returns Promise that resolves to this database instance for method chaining
   * @throws {Error} If validation fails or section doesn't exist
   * 
   * @example
   * ```typescript
   * await db.insert(notesSpec, {
   *   name: 'Project Ideas',
   *   description: 'Collection of project concepts',
   *   sections: ['tech', 'personal']
   * }, '## Active Notes', false); // Add at end
   * ```
   */
  async insert<T>(
    spec: CollectionSpec<T>,
    data: T,
    heading: string,
    add_at_start = true
  ): Promise<MarkdownDatabase> {
    const value = spec.schema.parse(data);
    await this.load();
    this.insert_into_note<T>(spec, heading, value, add_at_start);
    return this;
  }

  /**
   * Inserts multiple records into the specified markdown section.
   * All records are validated against the collection spec's schema before insertion.
   * 
   * @template T - Type of the records to insert
   * @param spec - Collection specification defining how to handle this type
   * @param data - Array of untyped data that will be validated and inserted
   * @param heading - Markdown heading that defines the target section
   * @returns Promise that resolves to array of validated and inserted records
   * @throws {Error} If any validation fails or section doesn't exist
   * 
   * @example
   * ```typescript
   * const insertedNotes = await db.insert_all(notesSpec, [
   *   { name: 'Note 1', description: 'First note' },
   *   { name: 'Note 2', description: 'Second note' }
   * ], '## Bulk Notes');
   * console.log(`Inserted ${insertedNotes.length} notes`);
   * ```
   */
  async insert_all<T>(
    spec: CollectionSpec<T>,
    data: unknown[],
    heading: string
  ): Promise<T[]> {
    await this.load();
    const parsed_data = data.map((d) => spec.schema.parse(d));
    for (const d of parsed_data) {
      this.insert_into_note<T>(spec, heading, d, false);
    }
    return parsed_data;
  }

  private insert_into_note<T>(
    spec: CollectionSpec<T>,
    heading: string,
    value: T,
    add_at_start: boolean
  ) {
    const section = spec.extractSection(this.content, heading);
    const new_lines = spec.toMarkdown(value);

    if (add_at_start) {
      section.blocks.unshift(new_lines);
    } else {
      section.blocks.push(new_lines);
    }
    this.rewriteSection(
      section,
      spec.addEmptyLineBetweenBlocks,
      spec.addAnEmptyLineAtEndOfBlocks
    );
  }

  /**
   * Creates or updates a file with raw content in the same directory as the database.
   * Returns a new MarkdownDatabase instance pointing to the created file.
   * 
   * @param filename - Name of the file to create or update
   * @param content - Raw content to write to the file
   * @returns Promise that resolves to new MarkdownDatabase instance for the created file
   * @throws {Error} If file creation fails
   * 
   * @example
   * ```typescript
   * // Create a config file alongside the main database
   * const configDb = await db.upsert_raw('config.md', '# Configuration\n\nSettings here');
   * await configDb.save();
   * ```
   */
  async upsert_raw(
    filename: string,
    content: string
  ): Promise<MarkdownDatabase> {
    const file_path = this.get_file_path(filename);
    await fs.mkdir(dirname(file_path), { recursive: true });
    await fs.writeFile(file_path, content);
    
    // Return a new MarkdownDatabase instance for the created file
    return new MarkdownDatabase(file_path);
  }

  private validate_section_exists(section: SectionExtraction, heading: string): void {
    if (section.start === -1) {
      throw new Error(`Section '${heading}' not found in document`);
    }
  }

  private does_block_match<T>(
    spec: CollectionSpec<T>,
    replacement: T,
    block: string[]
  ): boolean {
    return spec.matchesExistingBlock
      ? spec.matchesExistingBlock(replacement, block)
      : block.join("\n") === spec.toMarkdown(replacement).join("\n");
  }

  private update_or_replace_blocks<T>(
    spec: CollectionSpec<T>,
    replacement: T,
    blocks: string[][]
  ): { blocks: string[][]; found: boolean } {
    let found = false;
    const updated_blocks = blocks.map((block) => {
      if (this.does_block_match(spec, replacement, block)) {
        found = true;
        return spec.toMarkdown(replacement);
      }
      return block;
    });
    return { blocks: updated_blocks, found };
  }

  private add_new_block_if_not_found<T>(
    spec: CollectionSpec<T>,
    replacement: T,
    blocks: string[][],
    found: boolean,
    add_at_start: boolean
  ): string[][] {
    if (!found) {
      const new_markdown = spec.toMarkdown(replacement);
      if (add_at_start) {
        blocks.unshift(new_markdown);
      } else {
        blocks.push(new_markdown);
      }
    }
    return blocks;
  }

  /**
   * Inserts a record if it doesn't exist, or updates it if a matching record is found.
   * Matching is determined by the collection spec's `matchesExistingBlock` method,
   * or by exact string comparison if no custom matcher is provided.
   * 
   * @template T - Type of the record to upsert
   * @param spec - Collection specification defining how to handle this type
   * @param replacement - The typed record to insert or use for replacement
   * @param heading - Markdown heading that defines the target section
   * @param add_at_start - Whether to add new records at start or end of section (default: true)
   * @returns Promise that resolves to this database instance for method chaining
   * @throws {Error} If validation fails or section doesn't exist
   * 
   * @example
   * ```typescript
   * // Update existing note or create new one
   * await db.upsert(notesSpec, {
   *   name: 'Updated Note',
   *   description: 'This will replace existing note with same name'
   * }, '## Notes');
   * ```
   */
  async upsert<T>(
    spec: CollectionSpec<T>,
    replacement: T,
    heading: string,
    add_at_start = true
  ): Promise<MarkdownDatabase> {
    await this.load();
    const section = spec.extractSection(this.content, heading);

    this.validate_section_exists(section, heading);

    const { blocks: updated_blocks, found } = this.update_or_replace_blocks(
      spec,
      replacement,
      section.blocks
    );

    const final_blocks = this.add_new_block_if_not_found(
      spec,
      replacement,
      updated_blocks,
      found,
      add_at_start
    );

    section.blocks = final_blocks;
    this.rewriteSection(
      section,
      spec.addEmptyLineBetweenBlocks,
      spec.addAnEmptyLineAtEndOfBlocks
    );
    return this;
  }

  /**
   * Removes a record from the specified markdown section.
   * The record to delete is matched by exact string comparison of its serialized form.
   * 
   * @template T - Type of the record to delete
   * @param spec - Collection specification defining how to handle this type
   * @param record - The typed record to remove (must match exactly)
   * @param heading - Markdown heading that defines the target section
   * @returns Promise that resolves when deletion is complete
   * @throws {Error} If section doesn't exist
   * 
   * @example
   * ```typescript
   * await db.delete(notesSpec, {
   *   name: 'Obsolete Note',
   *   description: 'This note is no longer needed'
   * }, '## Notes');
   * ```
   */
  async delete<T>(
    spec: CollectionSpec<T>,
    record: T,
    heading: string
  ): Promise<void> {
    await this.load();
    const section = spec.extractSection(this.content, heading);

    // Convert the record to markdown for comparison
    const record_markdown = spec.toMarkdown(record).join("\n");

    const blocks = section.blocks.filter((block) => {
      const block_markdown = block.join("\n");
      return block_markdown !== record_markdown;
    });

    section.blocks = blocks;
    this.rewriteSection(
      section,
      spec.addEmptyLineBetweenBlocks,
      spec.addAnEmptyLineAtEndOfBlocks
    );
    if (this.content.indexOf(heading) === -1) {
      throw new Error(`Section '${heading}' not found`);
    }
  }

  private rewriteSection(
    section: SectionExtraction,
    add_line_break_after_each_block: boolean,
    add_line_break_after_all_blocks: boolean
  ): void {
    const lines = this.content.split("\n");
    const before_section = lines.slice(0, section.start);
    const after_section = lines.slice(section.end_exclusive);

    // Add a blank line after the heading if there are blocks to insert
    const content_lines = section.blocks.length > 0 ? [""] : [];

    const new_content = [
      ...before_section,
      ...content_lines,
      ...section.blocks.flatMap((b) =>
        add_line_break_after_each_block ? [...b, ""] : b
      ),
      ...(add_line_break_after_all_blocks ? [""] : []),
      ...after_section,
    ].join("\n");
    this.content = new_content;
  }
}

/* ─────────────── Section Parsers ──────────────── */

/* Common utility functions for section extraction */
function extract_section_boundaries(
  content: string,
  heading: string
): { lines: string[]; start: number; end: number } {
  const lines = content.split("\n");
  let section_start = lines.findIndex((l) => l.trim() === heading);
  if (section_start === -1) {
    throw new Error(`Section '${heading}' not found`);
  }
  section_start += 2; // skip the heading line and leave a blank line

  const next_section_idx = lines.slice(section_start).findIndex((l) => {
    const trimmed = l.trim();
    return trimmed.match(/^##\s/) && trimmed !== heading;
  });

  const end_of_section_idx =
    next_section_idx === -1 ? lines.length : section_start + next_section_idx;

  const section_lines = lines.slice(section_start, end_of_section_idx);

  return {
    lines: section_lines,
    start: section_start,
    end: end_of_section_idx,
  };
}

function extract_blocks_from_section(
  section: { lines: string[]; start: number; end: number },
  start_block_condition: (line: string) => boolean,
  end_block_condition: (line: string) => boolean
): SectionExtraction {
  const blocks: string[][] = [];
  let current_block: string[] = [];
  let is_in_block = false;

  for (const line of section.lines) {
    if (start_block_condition(line)) {
      if (current_block.length > 0) {
        // remove trailing empty lines
        while (
          current_block.length > 0 &&
          current_block[current_block.length - 1].trim() === ""
        ) {
          current_block.pop();
        }
        blocks.push(current_block);
        current_block = [];
      }
      is_in_block = true;
    } else if (end_block_condition(line)) {
      is_in_block = false;
    }

    if (line.trim() !== "" && is_in_block) {
      current_block.push(line);
    }
  }

  if (current_block.length > 0) {
    // remove trailing empty lines
    while (
      current_block.length > 0 &&
      current_block[current_block.length - 1].trim() === ""
    ) {
      current_block.pop();
    }
    blocks.push(current_block);
  }

  return {
    start: section.start,
    end_exclusive: section.end,
    blocks,
  };
}

export const notes_spec: CollectionSpec<z.infer<typeof NoteSchema>> = {
  addEmptyLineBetweenBlocks: false,
  addAnEmptyLineAtEndOfBlocks: true,
  schema: NoteSchema,
  toMarkdown: (c) => [`- [[${c.name}]]`],
  extractSection: (content: string, heading: string): SectionExtraction => {
    const section = extract_section_boundaries(content, heading);
    return extract_blocks_from_section(
      section,
      (line) => line.startsWith("- ["),
      (line) => line.trim() === ""
    );
  },
};
