/**
 * The note-stub RENDERER (TASK-36.8) — the PKM-native backbone's pure core.
 * Turns one cluster (a {@link ClusterDetail} from {@link cluster_reads}) into an
 * agent-authored markdown stub: an H1, a scope/time line, a one-line summary, and
 * a "Pages in this thread" list whose member links each carry a machine-matchable
 * citation comment. Pure — no `fs`, no clock (`generated_at` is injected) — so the
 * template, the lineage/filename scheme, and the fingerprint are trivially
 * testable. {@link staging_writer} owns all filesystem effects.
 *
 * The stub is written ONLY into a quarantined `bergamot.staging/` directory and
 * promoted by hand (constitution principle 8). The citation comment
 * `<!-- bergamot:cite page_session_id=… url=… -->` is the key the right-to-forget
 * filesystem sweep matches on.
 */
import { createHash } from "crypto";
import { canonical_json } from "@bergamot/tdt";
import type { ClusterDetail, ClusterMember } from "./cluster_reads";

export interface RenderedStub {
  filename: string; // deterministic per lineage, e.g. "2026-W25--local-graph-clustering.md"
  lineage_key: string; // the stable identity the filename derives from
  fingerprint: string; // content fingerprint for the change gate
  markdown: string;
  cited_page_session_ids: string[];
}

export interface ParsedCitation {
  page_session_id: string;
  url: string;
}

// The URL is percent-encoded in the citation so it always round-trips: any
// whitespace or a literal "-->" in a stored URL would otherwise break the match
// the right-to-forget sweep depends on.
const CITE_RE = /<!--\s*bergamot:cite\s+page_session_id=(\S+)\s+url=(\S*)\s*-->/g;

function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** ISO-8601 week label `YYYY-Wnn` for the date's Thursday (ISO week rule). */
export function iso_week(iso: string): string {
  const d = new Date(iso);
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  // Thursday in current week decides the year.
  const day = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - day + 3);
  const first_thursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const first_day = (first_thursday.getUTCDay() + 6) % 7;
  first_thursday.setUTCDate(first_thursday.getUTCDate() - first_day + 3);
  const week =
    1 +
    Math.round(
      (date.getTime() - first_thursday.getTime()) / (7 * 24 * 3600 * 1000),
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** A filename-safe slug: lowercase, non-alphanumerics → '-', trimmed, capped. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function cluster_label(cluster: ClusterDetail["cluster"]): string {
  return cluster.headline_title?.trim() || cluster.display_label?.trim() || "";
}

/**
 * The stable lineage identity a stub's filename derives from. Keyed on the ISO
 * week of the cluster's start plus a slug of its label, so a re-run of the same
 * conceptual thread lands on the SAME file rather than spawning a duplicate. The
 * per-run cluster id is deliberately NOT used (it rotates every recompute). When
 * the label is empty the exemplar id anchors a stable fallback. (`lifeline_id`
 * will be the authoritative anchor once Phase-4 lineage tracking lands.)
 *
 * Residual: two distinct clusters with the same week + label slug collide on one
 * filename, so the second overwrites the first's stub. Accepted for v1 — same-week
 * identical-label threads are rare; `lifeline_id` is the clean fix.
 */
export function compute_lineage_key(cluster: ClusterDetail): string {
  const week = iso_week(cluster.cluster.time_span.start);
  const label = cluster_label(cluster.cluster);
  // Empty-label fallback anchors on the exemplar page (a stable id), else the
  // first member, else the cluster id — so the key is always non-degenerate.
  const exemplar_id =
    cluster.exemplar_page?.page_session_id ??
    cluster.members[0]?.page_session_id ??
    cluster.cluster.id;
  const anchor = label ? slug(label) : `cluster-${exemplar_id.slice(0, 16)}`;
  return `${week}--${anchor}`;
}

export function compute_stub_filename(cluster: ClusterDetail): string {
  return `${compute_lineage_key(cluster)}.md`;
}

/**
 * A content fingerprint over the inputs that affect the rendered body — NOT over
 * the markdown (which embeds run_id/generated_at that change every run without
 * changing what the user sees). The change gate skips rewriting when this is
 * unchanged.
 */
export function compute_stub_fingerprint(cluster: ClusterDetail): string {
  const c = cluster.cluster;
  return sha256_hex(
    canonical_json({
      lineage_key: compute_lineage_key(cluster),
      headline_title: c.headline_title ?? "",
      display_label: c.display_label ?? "",
      scope: c.scope ?? "",
      keyphrases: [...c.keyphrases].sort(),
      size: c.size,
      time_span: c.time_span,
      members: cluster.members
        .map((m) => ({
          page_session_id: m.page_session_id,
          url: m.url ?? "",
          is_exemplar: m.is_exemplar,
        }))
        .sort((a, b) => a.page_session_id.localeCompare(b.page_session_id)),
    }),
  );
}

/** Exemplar first, then members in their given (probability-DESC) order. */
function ordered_members(members: ClusterMember[]): ClusterMember[] {
  const exemplars = members.filter((m) => m.is_exemplar);
  const rest = members.filter((m) => !m.is_exemplar);
  return [...exemplars, ...rest];
}

function member_line(m: ClusterMember): string {
  const url = m.url ?? "";
  const text = (m.title?.trim() || url || m.page_session_id).replace(/\n/g, " ");
  const pin = m.is_exemplar ? " (exemplar, pinned)" : "";
  const link = url ? `[${text}](${url})` : text;
  return (
    `- ${link}${pin}\n` +
    `<!-- bergamot:cite page_session_id=${m.page_session_id} url=${encodeURIComponent(url)} -->`
  );
}

function date_only(iso: string): string {
  return iso.slice(0, 10);
}

/** Render one cluster to a staged-stub markdown document. */
export function render_note_stub(
  cluster: ClusterDetail,
  ctx: { run_id: string; generated_at: string },
): RenderedStub {
  const c = cluster.cluster;
  const lineage_key = compute_lineage_key(cluster);
  const fingerprint = compute_stub_fingerprint(cluster);
  const members = ordered_members(cluster.members);

  const heading = cluster_label(c) || lineage_key.replace(/-/g, " ");
  const span = `${date_only(c.time_span.start)} → ${date_only(c.time_span.end)}`;
  const scope_line = c.scope ? `Scope: ${c.scope} · ${span}` : span;
  const summary = `> ${c.size} page${c.size === 1 ? "" : "s"} cohered around ${
    cluster_label(c) || "this topic"
  } over ${span}. Review and promote to make it yours.`;

  const tags =
    c.keyphrases.length > 0
      ? `tags:\n${c.keyphrases.map((k) => `  - ${k}`).join("\n")}\n`
      : "";

  const frontmatter =
    `---\n` +
    `bergamot_agent_authored: true\n` +
    `run_id: ${ctx.run_id}\n` +
    `generated_at: ${ctx.generated_at}\n` +
    `lineage_key: ${lineage_key}\n` +
    `fingerprint: ${fingerprint}\n` +
    // The cluster's window bounds — the right-to-forget time-range sweep reads
    // these to decide whether a stub may encode a forgotten page.
    `window_start: ${c.time_span.start}\n` +
    `window_end: ${c.time_span.end}\n` +
    tags +
    `---\n`;

  const markdown =
    `${frontmatter}\n` +
    `# ${heading}\n\n` +
    `${scope_line}\n\n` +
    `${summary}\n\n` +
    `## Pages in this thread\n\n` +
    `${members.map(member_line).join("\n")}\n`;

  return {
    filename: `${lineage_key}.md`,
    lineage_key,
    fingerprint,
    markdown,
    cited_page_session_ids: cluster.members.map((m) => m.page_session_id),
  };
}

/** Extract every citation comment from a staged stub. Pure; used by the sweep. */
export function parse_citations(markdown: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  for (const match of markdown.matchAll(CITE_RE)) {
    let url = "";
    try {
      url = decodeURIComponent(match[2]);
    } catch {
      url = match[2]; // tolerate a malformed encoding rather than drop the citation
    }
    out.push({ page_session_id: match[1], url });
  }
  return out;
}
