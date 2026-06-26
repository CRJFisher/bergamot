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
 * Quarantine is enforced by an auto-written `.gitignore` (`*`) so a staging dir
 * nested in a PKM/git repo can never be committed or synced (principle 6).
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

export function stage_note_stubs(
  staging_root: string,
  clusters: ClusterDetail[],
  ctx: { run_id: string; generated_at: string },
): StageOutcome[] {
  return clusters.map((c) => stage_note_stub(staging_root, c, ctx));
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
function stub_matches(markdown: string, selector: ForgetSelector): boolean {
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
  for (const cite of parse_citations(markdown)) {
    if (selector.kind === "url" && cite.url === selector.url) return true;
    if (selector.kind === "origin" && url_has_origin(cite.url, selector.origin))
      return true;
  }
  return false;
}

/**
 * Delete every staged stub citing content the selector forgets, and drop its
 * ledger entry so a future run may legitimately re-stage surviving threads. A
 * forgotten stub's ledger entry is REMOVED (eligible to recreate from non-
 * forgotten data) — distinct from a user-promoted stub, whose entry stays and
 * whose file-absence means "skip". Idempotent; unreadable entries are left alone.
 */
export function sweep_staged_stubs(
  staging_root: string,
  selector: ForgetSelector,
): number {
  let removed = 0;
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
  for (const entry of entries) {
    const file_path = path.join(staging_root, entry);
    try {
      const markdown = fs.readFileSync(file_path, "utf8");
      if (!stub_matches(markdown, selector)) continue;
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
  if (ledger_dirty) write_ledger(staging_root, ledger);
  return removed;
}
