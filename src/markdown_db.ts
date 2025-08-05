import { promises as fs } from "fs";
import { dirname } from "path";
import * as vscode from "vscode";
import { z } from "zod";
import { NoteSchema } from "./model_schema";
import { WebpageTreeNode, WebpageTreeNodeSchema } from "./webpage_tree_models";

/**
 * Result of extracting a section from markdown content
 *
 * Each section span includes its own trailing blank lines.
 */
export interface SectionExtraction {
  /** Line number where the section starts (-1 if not found) */
  start: number;
  /** Line number after the end of the section */
  end_exclusive: number;
  /** Content blocks within the section */
  blocks: string[][];
}

/** Any typed section you want to expose */
export interface CollectionSpec<T> {
  /** Whether to insert a blank line between blocks */
  addEmptyLineBetweenBlocks: boolean;
  addAnEmptyLineAtEndOfBlocks: boolean;
  /** Zod schema for runtime validation */
  schema: z.ZodSchema<T>;
  /** Serialize one record back to markdown lines */
  toMarkdown(t: T): string[];
  /** Extract section content and split into blocks */
  extractSection(content: string, heading: string): SectionExtraction;
  /**
   * Optional: Check if an object matches an existing block based on partial comparison
   * If not provided, falls back to exact string matching
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
        const childLines = WebpageTreeNodeCollectionSpec.toMarkdown(child);
        lines.push(...childLines);
      }
    }

    return lines;
  },

  matchesExistingBlock: (
    node: WebpageTreeNode,
    existingBlock: string[]
  ): boolean => {
    // Get the markdown representation of the new node
    const nodeMarkdown = WebpageTreeNodeCollectionSpec.toMarkdown(node);

    // Simply compare the entire first line (title, URL, and timestamp)
    if (existingBlock.length === 0 || nodeMarkdown.length === 0) {
      return false;
    }

    const nodeFirstLine = nodeMarkdown[0];
    const existingFirstLine = existingBlock[0];

    return nodeFirstLine === existingFirstLine;
  },

  extractSection: (content: string, heading: string): SectionExtraction => {
    const lines = content.split("\n");
    let start = -1;
    let end = lines.length;
    let currentBlock: string[] = [];
    const blocks: string[][] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === heading) {
        if (start === -1) {
          start = i + 1; // Start AFTER the heading line, not at it
        } else {
          // We found the next heading, end the current section
          if (currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [];
          }
          end = i;
          break;
        }
      } else if (start !== -1) {
        if (line.trim() === "") {
          if (currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [];
          }
        } else {
          currentBlock.push(line);
        }
      }
    }

    // Don't forget the last block
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    return { start, end_exclusive: end, blocks };
  },
};

/** A very small NoSQL database whose storage engine is a markdown file. */
export class MarkdownDatabase {
  private textDoc: vscode.TextDocument | null = null;
  private content = "";
  constructor(private readonly path: string) {}

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
   * Insert one record. Returns the validated record.
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
    const newLines = spec.toMarkdown(value);

    if (add_at_start) {
      section.blocks.unshift(newLines);
    } else {
      section.blocks.push(newLines);
    }
    this.rewriteSection(
      section,
      spec.addEmptyLineBetweenBlocks,
      spec.addAnEmptyLineAtEndOfBlocks
    );
  }

  /**
   * Insert or replace raw content at a file path
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

  /**
   * Replace the record identified by `match` with `replacement`.
   */
  async upsert<T>(
    spec: CollectionSpec<T>,
    replacement: T,
    heading: string,
    add_at_start = true
  ): Promise<MarkdownDatabase> {
    await this.load();
    const section = spec.extractSection(this.content, heading);

    // Check if section was found
    if (section.start === -1) {
      throw new Error(`Section '${heading}' not found in document`);
    }

    let found = false;
    const blocks = section.blocks.map((block) => {
      // Use the custom matching logic if available, otherwise fall back to exact string comparison
      const matches = spec.matchesExistingBlock
        ? spec.matchesExistingBlock(replacement, block)
        : block.join("\n") === spec.toMarkdown(replacement).join("\n");

      if (matches) {
        found = true;
        return spec.toMarkdown(replacement);
      }
      return block;
    });

    if (!found) {
      if (add_at_start) {
        blocks.unshift(spec.toMarkdown(replacement));
      } else {
        blocks.push(spec.toMarkdown(replacement));
      }
    }
    section.blocks = blocks;
    this.rewriteSection(
      section,
      spec.addEmptyLineBetweenBlocks,
      spec.addAnEmptyLineAtEndOfBlocks
    );
    return this;
  }

  async delete<T>(
    spec: CollectionSpec<T>,
    record: T,
    heading: string
  ): Promise<void> {
    await this.load();
    const section = spec.extractSection(this.content, heading);

    // Convert the record to markdown for comparison
    const recordMarkdown = spec.toMarkdown(record).join("\n");

    const blocks = section.blocks.filter((block) => {
      const blockMarkdown = block.join("\n");
      return blockMarkdown !== recordMarkdown;
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
    const beforeSection = lines.slice(0, section.start);
    const afterSection = lines.slice(section.end_exclusive);

    // Add a blank line after the heading if there are blocks to insert
    const contentLines = section.blocks.length > 0 ? [""] : [];

    const new_content = [
      ...beforeSection,
      ...contentLines,
      ...section.blocks.flatMap((b) =>
        add_line_break_after_each_block ? [...b, ""] : b
      ),
      ...(add_line_break_after_all_blocks ? [""] : []),
      ...afterSection,
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
