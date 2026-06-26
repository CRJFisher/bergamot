/**
 * The staging WRITER (TASK-36.8) — all filesystem effects for the note-stub
 * backbone. Writes agent-authored stubs into a quarantined `bergamot.staging/`
 * directory inside the user's PKM workspace (never canonical notes — constitution
 * principle 8), idempotently, and owns the right-to-forget filesystem sweep over
 * those plaintext stubs.
 *
 * Three guarantees beyond a naive write:
 *   - **Idempotent per lineage.** A re-run overwrites its own un-promoted draft
 *     in place (the deterministic {@link compute_lineage_key} filename), never
 *     spawning a duplicate for the same thread.
 *   - **Promotion-safe.** A ledger (`.bergamot-ledger.json`) records every lineage
 *     ever emitted. A lineage in the ledger whose file is gone was moved /
 *     promoted / discarded by the user — it is NEVER recreated or resurrected. A
 *     filename present on disk but absent from the ledger is treated as user-owned
 *     and never clobbered.
 *   - **Change-gated.** An unchanged content fingerprint skips the write, so
 *     mtimes (and the user's file-watcher) do not churn.
 *
 * Quarantine is enforced by an auto-written `.gitignore` (`*`) so a freshly-created
 * staging dir nested in a PKM/git repo is not committed or synced (principle 6).
 * (`.gitignore` does not retroactively untrack files already committed before it
 * existed — a non-issue for a dir Bergamot creates.)
 */
import * as fs from "fs";
import * as path from "path";
import { render_note_stub, parse_citations } from "./note_stub";
import type { ClusterDetail } from "./cluster_reads";
import type { ForgetSelector } from "../right_to_forget";

const LEDGER_FILE = ".bergamot-ledger.json";
const GITIGNORE_CONTENTS =
  "# Bergamot agent-authored staging — quarantined, never commit (constitution principle 6).\n" +
  "# Stubs are drafts you promote by hand; promotion = moving a file OUT of this directory.\n" +
  "*\n";

export interface StageOutcome {
  kind: "written" | "skipped_unchanged" | "skipped_promoted";
  filename: string;
}

interface LedgerEntry {
  lineage_key: string;
  filename: string;
  fingerprint: string;
  run_id: string;
  generated_at: string;
  cited_page_session_ids: string[];
}
interface StagingLedger {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

/** Ensure the quarantine `.gitignore` exists. Idempotent; never rewrites it. */
export function ensure_staging_gitignore(staging_root: string): void {
  fs.mkdirSync(staging_root, { recursive: true });
  const gitignore = path.join(staging_root, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, GITIGNORE_CONTENTS);
  }
}

function ledger_path(staging_root: string): string {
  return path.join(staging_root, LEDGER_FILE);
}

function read_ledger(staging_root: string): StagingLedger {
  try {
    const raw = fs.readFileSync(ledger_path(staging_root), "utf8");
    const parsed = JSON.parse(raw) as StagingLedger;
    if (parsed && parsed.version === 1 && parsed.entries) return parsed;
  } catch {
    // Missing or corrupt — treat as empty (never throw; the on-disk filename
    // backstop still protects user-owned files).
  }
  return { version: 1, entries: {} };
}

function write_ledger(staging_root: string, ledger: StagingLedger): void {
  const target = ledger_path(staging_root);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, target); // atomic replace
}

/**
 * Write one stub idempotently. See the module header for the promotion-safe
 * decision matrix and the change gate.
 */
export function stage_note_stub(
  staging_root: string,
  cluster: ClusterDetail,
  ctx: { run_id: string; generated_at: string },
): StageOutcome {
  ensure_staging_gitignore(staging_root);
  const rendered = render_note_stub(cluster, ctx);
  const ledger = read_ledger(staging_root);
  const existing = ledger.entries[rendered.lineage_key];
  const file_path = path.join(staging_root, rendered.filename);
  const on_disk = fs.existsSync(file_path);

  if (existing) {
    if (!on_disk) {
      // Known lineage, file gone → user promoted/discarded it. Leave it alone.
      return { kind: "skipped_promoted", filename: rendered.filename };
    }
    if (existing.fingerprint === rendered.fingerprint) {
      return { kind: "skipped_unchanged", filename: rendered.filename };
    }
  } else if (on_disk) {
    // Ledger-desync backstop: a file we don't know about is user-owned.
    return { kind: "skipped_promoted", filename: rendered.filename };
  }

  fs.writeFileSync(file_path, rendered.markdown);
  ledger.entries[rendered.lineage_key] = {
    lineage_key: rendered.lineage_key,
    filename: rendered.filename,
    fingerprint: rendered.fingerprint,
    run_id: ctx.run_id,
    generated_at: ctx.generated_at,
    cited_page_session_ids: rendered.cited_page_session_ids,
  };
  write_ledger(staging_root, ledger);
  return { kind: "written", filename: rendered.filename };
}

/** Origin equality via URL parse (mirrors right_to_forget.has_origin). */
function url_has_origin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Read `window_start`/`window_end` from a stub's YAML frontmatter, if present. */
function read_window(markdown: string): { start: string; end: string } | null {
  const start = /^window_start:\s*(\S+)\s*$/m.exec(markdown);
  const end = /^window_end:\s*(\S+)\s*$/m.exec(markdown);
  return start && end ? { start: start[1], end: end[1] } : null;
}

/** True when the stub at `markdown` cites content the selector forgets. */
function stub_matches(
  markdown: string,
  selector: ForgetSelector,
  forgotten_ids: Set<string>,
): boolean {
  const citations = parse_citations(markdown);
  // Primary match: a cited page is in the resolved forget set. This is URL-
  // independent, so it reaches a stub even when a member has no URL or an
  // unencodable one — the page_session_id is always present and clean.
  if (forgotten_ids.size > 0) {
    for (const cite of citations) {
      if (forgotten_ids.has(cite.page_session_id)) return true;
    }
  }
  if (selector.kind === "time_range") {
    // Citations carry no per-page timestamp; a stub is a derived aggregate, so if
    // its window overlaps the forget range it MAY encode a forgotten page — delete
    // it (the privacy-safe over-delete; a later run re-stages surviving threads).
    const window = read_window(markdown);
    if (!window) return false;
    const from = Date.parse(selector.from);
    const to = Date.parse(selector.to);
    const ws = Date.parse(window.start);
    const we = Date.parse(window.end);
    return ws <= to && we >= from;
  }
  // Fallback for a url/origin selector that resolved no live id (e.g. an orphan
  // URL): match the cited URL directly.
  for (const cite of citations) {
    if (selector.kind === "url" && cite.url === selector.url) return true;
    if (selector.kind === "origin" && url_has_origin(cite.url, selector.origin))
      return true;
  }
  return false;
}

/**
 * Delete every staged stub citing content the selector forgets, and scrub the
 * ledger so no forgotten page id survives (principle 4). On-disk stubs that match
 * are unlinked and their ledger entry dropped. Ledger entries whose file is gone
 * (a user-PROMOTED stub) but whose cited pages are in the forget set are also
 * dropped — the file is the user's now and is left alone, but the ledger must not
 * keep encoding a forgotten `page_session_id`. A forgotten lineage becomes
 * eligible to re-stage from surviving data, distinct from a promotion the user
 * made with no forget, whose entry stays so its file-absence means "skip".
 * Idempotent; unreadable entries are left alone.
 *
 * @param forgotten_page_session_ids - the pages the forget resolved; the primary,
 *   URL-independent match key.
 */
export function sweep_staged_stubs(
  staging_root: string,
  selector: ForgetSelector,
  forgotten_page_session_ids: string[] = [],
): number {
  let removed = 0;
  const forgotten_ids = new Set(forgotten_page_session_ids);
  let entries: string[];
  try {
    entries = fs.readdirSync(staging_root).filter((f) => f.endsWith(".md"));
  } catch {
    return 0; // No staging dir — nothing staged.
  }
  const ledger = read_ledger(staging_root);
  const by_filename = new Map(
    Object.values(ledger.entries).map((e) => [e.filename, e.lineage_key]),
  );
  let ledger_dirty = false;
  const on_disk = new Set(entries);
  for (const entry of entries) {
    const file_path = path.join(staging_root, entry);
    try {
      const markdown = fs.readFileSync(file_path, "utf8");
      if (!stub_matches(markdown, selector, forgotten_ids)) continue;
      fs.unlinkSync(file_path);
      removed++;
      const lineage_key = by_filename.get(entry);
      if (lineage_key && ledger.entries[lineage_key]) {
        delete ledger.entries[lineage_key];
        ledger_dirty = true;
      }
    } catch {
      // Unreadable or already-removed — not this sweep's problem.
    }
  }
  // Scrub promoted-out ledger entries (file gone) that still cite a forgotten page.
  if (forgotten_ids.size > 0) {
    for (const [lineage_key, e] of Object.entries(ledger.entries)) {
      if (on_disk.has(e.filename)) continue;
      if (e.cited_page_session_ids.some((id) => forgotten_ids.has(id))) {
        delete ledger.entries[lineage_key];
        ledger_dirty = true;
      }
    }
  }
  if (ledger_dirty) write_ledger(staging_root, ledger);
  return removed;
}
