// import { DuckDB, get_all_webpage_notes } from "./duck_db";
// import { MarkdownDatabase, notes_spec } from "./markdown_db";
// import { NoteTools } from "./note_tools";

// const RECENT_NOTES_HEADING = "## Recent Notes";
// const SUGGESTED_NOTES_HEADING = "## Suggested Notes (based on recent browsing)";

// export async function populate_home_page(
//   duck_db: DuckDB,
//   markdown_db: MarkdownDatabase,
//   notes_to_suggest: number
// ): Promise<void> {
//   const all_notes = await NoteTools.fetch_existing_notes();

//   // Recent notes
//   const recent_notes = all_notes
//     .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
//     .slice(0, notes_to_suggest);
//   await markdown_db.delete(notes_spec, () => true, RECENT_NOTES_HEADING);
//   await markdown_db.insert_all(notes_spec, recent_notes, RECENT_NOTES_HEADING);

//   // Suggested notes
//   const suggested_note_names = (await get_suggested_notes(duck_db)).slice(
//     0,
//     notes_to_suggest
//   );
//   const note_name_to_note = Object.fromEntries(
//     all_notes.map((note) => [note.path, note])
//   );
//   const suggested_notes = suggested_note_names
//     .map((note_name) => note_name_to_note[note_name])
//     .filter(Boolean);
//   await markdown_db.delete(notes_spec, () => true, SUGGESTED_NOTES_HEADING);
//   await markdown_db.insert_all(
//     notes_spec,
//     suggested_notes,
//     SUGGESTED_NOTES_HEADING
//   );

//   // Save all changes to file
//   await markdown_db.save();
// }

// async function get_suggested_notes(duck_db: DuckDB) {
//   const recent_webpage_categorizations = await get_all_webpage_notes(duck_db);
//   if (recent_webpage_categorizations.length === 0) {
//     return [];
//   }

//   const most_recent_webpage_visit = new Date(
//     recent_webpage_categorizations[0].webpage_visited_at
//   );
//   const least_recent_webpage_visit = new Date(
//     recent_webpage_categorizations[
//       recent_webpage_categorizations.length - 1
//     ].webpage_visited_at
//   );

//   // Create a map to store note scores
//   const note_scores = new Map<string, number>();

//   // Calculate the time range in milliseconds for normalization
//   const time_range_ms =
//     most_recent_webpage_visit.getTime() - least_recent_webpage_visit.getTime();

//   // Process each webpage categorization
//   for (const categorization of recent_webpage_categorizations) {
//     const visit_time = new Date(categorization.webpage_visited_at);

//     // Calculate normalized time (0 to 1) where 0 is least recent and 1 is most recent
//     const normalized_time =
//       (visit_time.getTime() - least_recent_webpage_visit.getTime()) /
//       time_range_ms;

//     // Calculate exponential decay score (e^(-2 * (1 - normalized_time)))
//     // This gives higher scores to more recent visits
//     const time_score = Math.exp(-2 * (1 - normalized_time));

//     // Add scores for each note associated with this webpage
//     const note = categorization.recommended_note_path;
//     const current_score = note_scores.get(note) || 0;
//     note_scores.set(note, current_score + time_score);
//   }

//   // Convert map to array and sort by score
//   const sorted_notes = Array.from(note_scores.entries())
//     .sort((a, b) => b[1] - a[1])
//     .map(([note_name]) => note_name);

//   return sorted_notes;
// }
