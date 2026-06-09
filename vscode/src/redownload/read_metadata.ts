/**
 * Cheap, deterministic `<head>` metadata extraction, applied to RE-DOWNLOADED
 * public pages (the re-download corpus, task-39.2). Capture itself reads no page
 * content; this parser runs only over content the re-download fetcher pulls back
 * from the public URL.
 *
 * Reads only the document `<head>` signals — `<title>`, Open-Graph / `<meta>`
 * tags, and the `<html lang>` attribute. The parse is a light regex scan so it
 * pulls in no heavyweight HTML/DOM dependency.
 */

/** Metadata read from a page's `<head>` / Open-Graph tags. */
export interface PageMetadata {
  /** Page title — `<title>`, falling back to `og:title`, then the URL. Always set. */
  title: string;
  /** Site/publication name from `og:site_name`, if present. */
  site_name: string | null;
  /** Author from `<meta name="author">` / `article:author`, if present. */
  author: string | null;
  /** Publication timestamp from `article:published_time` / `og:...` / `date`, if present. */
  published_at: string | null;
  /** Document language from `<html lang>` / `og:locale`, if present. */
  lang: string | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Returns the character for a numeric codepoint, or null if it is out of range. */
function codepoint_char(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/**
 * Decodes the small set of named/numeric HTML entities that appear in head text.
 * Single-pass so already-decoded text cannot re-trigger (e.g. `&amp;lt;` stays
 * `&lt;`), and out-of-range numeric refs are left verbatim rather than throwing.
 */
function decode_entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : Number(body.slice(1));
      return codepoint_char(code) ?? whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Reads one HTML attribute's value from a tag's attribute string. */
function read_attr(attrs: string, name: string): string | null {
  const match = attrs.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  if (!match) return null;
  const raw = match[2] ?? match[3] ?? match[4] ?? "";
  return decode_entities(raw.trim());
}

/**
 * Collects every `<meta>` tag into a key→content map keyed by its `name`,
 * `property`, or `itemprop` (lower-cased), independent of attribute order.
 */
function collect_meta(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  const tag_re = /<meta\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag_re.exec(html)) !== null) {
    const attrs = m[1];
    const key =
      read_attr(attrs, "property") ??
      read_attr(attrs, "name") ??
      read_attr(attrs, "itemprop");
    const content = read_attr(attrs, "content");
    if (key && content && !meta.has(key.toLowerCase())) {
      meta.set(key.toLowerCase(), content);
    }
  }
  return meta;
}

/** Returns the first present, non-empty value among the given meta keys. */
function first_meta(meta: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = meta.get(key);
    if (value && value.length > 0) return value;
  }
  return null;
}

/**
 * Reads cheap metadata from a page's `<head>` without any LLM call or
 * main-content extraction.
 *
 * @param html - The raw captured HTML page
 * @param url - The page URL, used as the title fallback when none is present
 */
export function read_metadata(html: string, url: string): PageMetadata {
  const meta = collect_meta(html);

  const title_tag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title_text = title_tag
    ? decode_entities(title_tag[1].replace(/\s+/g, " ").trim())
    : "";
  const title =
    title_text || first_meta(meta, ["og:title", "twitter:title"]) || url;

  const site_name = first_meta(meta, ["og:site_name", "application-name"]);

  const author = first_meta(meta, [
    "author",
    "article:author",
    "og:article:author",
    "twitter:creator",
  ]);

  const published_at = first_meta(meta, [
    "article:published_time",
    "og:article:published_time",
    "datepublished",
    "date",
    "pubdate",
    "dc.date",
  ]);

  const html_lang = html.match(/<html\b[^>]*\blang\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const lang =
    (html_lang
      ? decode_entities(
          (html_lang[2] ?? html_lang[3] ?? html_lang[4] ?? "").trim()
        )
      : null) || first_meta(meta, ["og:locale"]);

  return {
    title,
    site_name: site_name ?? null,
    author: author ?? null,
    published_at: published_at ?? null,
    lang: lang || null,
  };
}
