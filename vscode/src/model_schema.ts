import { z } from "zod";


/**
 * Schema for note objects in the personal knowledge management system.
 * Represents structured markdown notes with metadata and content organization.
 */
export const NoteSchema = z.object({
  /** The display name/title of the note */
  name: z.string().describe("The name of the note"),
  /** Array of section names that organize the note's content */
  sections: z
    .array(z.string())
    .describe("List of section names within this note"),
  /** Brief summary describing the note's purpose or main topic */
  description: z
    .string()
    .describe("A brief description of the note's purpose or content"),
  /** The full markdown content of the note */
  body: z.string().describe("The body of the note"),
  /** Absolute file system path to the note's markdown file */
  path: z.string().describe("The path to the note's markdown file"),
  /** Creation timestamp of the note */
  created_at: z.date().describe("The date and time the note was created"),
  /** Last modification timestamp of the note */
  updated_at: z.date().describe("The date and time the note was last updated"),
});

/**
 * Represents a structured note in the personal knowledge management system.
 * Notes are markdown files with metadata for organization and retrieval.
 * 
 * @interface Note
 * @example
 * ```typescript
 * const projectNote: Note = {
 *   name: 'Project Planning',
 *   sections: ['goals', 'timeline', 'resources'],
 *   description: 'Planning document for the new feature development',
 *   body: '# Project Planning\n\n## Goals\n...markdown content...',
 *   path: '/Users/john/notes/projects/new-feature.md',
 *   created_at: new Date('2024-01-01'),
 *   updated_at: new Date('2024-01-15')
 * };
 * ```
 */
export type Note = z.infer<typeof NoteSchema>;
