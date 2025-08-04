import { z } from "zod";


export const NoteSchema = z.object({
  name: z.string().describe("The name of the note"),
  sections: z
    .array(z.string())
    .describe("List of section names within this note"),
  description: z
    .string()
    .describe("A brief description of the note's purpose or content"),
  body: z.string().describe("The body of the note"),
  path: z.string().describe("The path to the note's markdown file"),
  created_at: z.date().describe("The date and time the note was created"),
  updated_at: z.date().describe("The date and time the note was last updated"),
});

export type Note = z.infer<typeof NoteSchema>;
