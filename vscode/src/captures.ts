/**
 * Bounded ring of raw page captures, kept so a developer can re-run the
 * classification/analysis pipeline on a real page without re-browsing it
 * (see the `bergamot.replayVisit` command).
 *
 * Distinct from the durable visit inbox: inbox entries are deleted once a visit
 * reaches DuckDB, whereas captures persist for replay until evicted by the ring.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtendedPageVisit } from './visit_queue_processor';

const CAPTURES_DIRNAME = 'captures';
const MAX_CAPTURES = 20;

export interface CaptureSummary {
  visit_id: string;
  url: string;
  page_loaded_at: string;
}

function captures_dir(storage_base: string): string {
  return path.join(storage_base, CAPTURES_DIRNAME);
}

function capture_file(storage_base: string, visit_id: string): string {
  // visit_id is normally a UUID or hex hash, but it can be browser-supplied, so
  // sanitize against path characters and cap the length (filesystems reject
  // names beyond ~255 bytes with ENAMETOOLONG).
  const safe = visit_id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return path.join(captures_dir(storage_base), `${safe}.json`);
}

/** Lists `.json` entries in `dir`, most recent first by mtime. */
function json_files_by_mtime(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ f }) => f);
}

/**
 * Persists a capture, then prunes the directory to the most recent
 * {@link MAX_CAPTURES} by mtime. Best-effort: failures never break capture.
 */
export function persist_capture(storage_base: string, visit: ExtendedPageVisit): void {
  try {
    const dir = captures_dir(storage_base);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(capture_file(storage_base, visit.visit_id), JSON.stringify(visit));
    prune(dir);
  } catch {
    /* best-effort */
  }
}

function prune(dir: string): void {
  for (const stale of json_files_by_mtime(dir).slice(MAX_CAPTURES)) {
    fs.rmSync(path.join(dir, stale), { force: true });
  }
}

/** Lists persisted captures, most recent first. */
export function list_captures(storage_base: string): CaptureSummary[] {
  const dir = captures_dir(storage_base);
  if (!fs.existsSync(dir)) return [];
  return json_files_by_mtime(dir).map((f) => {
    const visit = JSON.parse(
      fs.readFileSync(path.join(dir, f), 'utf-8')
    ) as ExtendedPageVisit;
    return {
      visit_id: visit.visit_id,
      url: visit.url,
      page_loaded_at: visit.page_loaded_at,
    };
  });
}

/** Loads a single capture by visit id, or null if it has been evicted. */
export function load_capture(
  storage_base: string,
  visit_id: string
): ExtendedPageVisit | null {
  const file = capture_file(storage_base, visit_id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as ExtendedPageVisit;
}
