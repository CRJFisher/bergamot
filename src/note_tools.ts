import { Note } from "./model_schema";
import { NoteSchema } from "./model_schema";
import { promises as fs } from "fs";
import { join, basename } from "path";

const notes_dir = "/Users/chuck/workspace/pkm";
const folders_to_ignore = ["/Users/chuck/workspace/pkm/Tasks/Weekly"];
const folder_partials_to_ignore = ["node_modules", "Front Page", ".obsidian"];

interface MarkdownFile {
  path: string;
  last_modified: Date;
  created_at: Date;
}

async function find_markdown_files(): Promise<MarkdownFile[]> {
  const markdown_files: MarkdownFile[] = [];

  try {
    await fs.access(notes_dir);
  } catch {
    throw new Error(`Directory ${notes_dir} does not exist`);
  }

  async function search_directory(dir_path: string) {
    try {
      const entries = await fs.readdir(dir_path, { withFileTypes: true });

      for (const entry of entries) {
        const full_path = join(dir_path, entry.name);

        // Skip ignored folders
        if (
          folders_to_ignore.includes(full_path) ||
          folder_partials_to_ignore.some((partial) =>
            full_path.includes(partial)
          )
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          await search_directory(full_path);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const stats = await fs.stat(full_path);
          markdown_files.push({
            path: full_path,
            last_modified: stats.mtime,
            created_at: stats.birthtime,
          });
        }
      }
    } catch (error) {
      console.error(`Error searching directory ${dir_path}:`, error);
    }
  }

  await search_directory(notes_dir);

  // Sort by last modified time, most recent first
  return markdown_files.sort(
    (a, b) => b.last_modified.getTime() - a.last_modified.getTime()
  );
}

export class NoteTools {
  static async fetch_existing_notes(limit?: number): Promise<Note[]> {
    console.log("Fetching notes...");
    const notes: Note[] = [];

    try {
      const markdown_files = await find_markdown_files();

      const markdown_files_to_read = limit
        ? markdown_files.slice(0, limit)
        : markdown_files;

      for (const file of markdown_files_to_read) {
        const note_name = basename(file.path, ".md");
        const sections: string[] = [];
        let description = "";

        const content = await fs.readFile(file.path, "utf8");
        const section_headings = content.match(/##\s+(.+?)($|\n)/g) || [];

        if (section_headings.length > 0) {
          sections.push(
            ...section_headings.map((h: string) =>
              h.replace(/^##\s+/, "").trim()
            )
          );
        } else {
          sections.push("General");
        }

        const first_heading_match = content.match(/^#\s+(.+?)$/m);
        if (first_heading_match) {
          const start_pos =
            first_heading_match.index! + first_heading_match[0].length;
          const first_section_match = content
            .slice(start_pos)
            .match(/^##\s+(.+?)$/m);

          if (first_section_match) {
            description = content
              .slice(start_pos, start_pos + first_section_match.index!)
              .trim();
          } else {
            description = content.slice(start_pos).trim();
          }
        }

        const note = NoteSchema.parse({
          name: note_name,
          sections: sections,
          description: description,
          path: file.path,
          body: content,
          created_at: file.created_at,
          updated_at: file.last_modified,
        });
        notes.push(note);
      }

      if (notes.length === 0) {
        throw new Error("No notes found");
      }
      return notes;
    } catch (error) {
      console.error("Error fetching notes:", error);
      throw error;
    }
  }

  static create_note(note_name: string): string {
    console.log(`Creating note: ${note_name}`);
    return `Successfully created note ${note_name}`;
  }

  static create_section(note_name: string, section_name: string): string {
    console.log(`Creating section: ${section_name} in ${note_name}`);
    return `Successfully created section ${section_name} in ${note_name}`;
  }
}
