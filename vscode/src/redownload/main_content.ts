/**
 * Heuristic main-content extraction over RE-DOWNLOADED public HTML (task-31.5).
 *
 * Capture stores browsing metadata only — no page body is ever persisted at
 * capture time. The re-download corpus (task-39.2) fetches the public URL on
 * demand; this module is the single point that turns that raw, boilerplate-laden
 * HTML into clean content for everything downstream (the content read path, the
 * encrypted content cache, Temporal Topic Detection, RAG).
 *
 * One Defuddle parse yields BOTH the clean main-content markdown (nav, footer,
 * aside, ad, and social boilerplate pruned via tree-pruning + content scoring)
 * AND the page's derived metadata (title, author, published time, site, lang).
 * It runs fully locally and deterministically: `useAsync: false` forbids
 * Defuddle's async extractors from reaching out to third-party APIs, which the
 * privacy model does not permit.
 */
import * as path from "path";

/** The subset of Defuddle's response this module reads. */
interface DefuddleResponse {
  /** Main content as markdown (because `markdown: true` is passed). */
  content: string;
  title: string;
  author: string;
  /** Publication time, passed through verbatim from the page. */
  published: string;
  /** Site / publication name. */
  site: string;
  /** Document language, from `<html lang>`. */
  language: string;
}

interface DefuddleOptions {
  markdown: boolean;
  useAsync: boolean;
}

interface DefuddleModule {
  Defuddle(
    input: string,
    url: string,
    options: DefuddleOptions
  ): Promise<DefuddleResponse>;
}

let defuddle_module: DefuddleModule | null = null;

/**
 * Loads `defuddle/node` once, cached for the process. That subpath carries the
 * HTML→markdown path but exposes only an ESM `import` export condition, so a
 * CommonJS `require("defuddle/node")` is rejected by the package's exports map.
 * A dynamic `import()` is no escape either: under the CommonJS module target
 * (the extension host and jest) it transpiles to that same rejected require.
 * Resolving the package's main entry (its `.` export has a `require` condition)
 * and requiring the sibling `node.js` by absolute path sidesteps the exports
 * restriction — the file itself is CommonJS — in both the extension host and jest.
 */
function load_defuddle(): DefuddleModule {
  if (!defuddle_module) {
    const main_path = require.resolve("defuddle");
    const node_path = path.join(path.dirname(main_path), "node.js");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    defuddle_module = require(node_path) as DefuddleModule;
  }
  return defuddle_module;
}

/** Derived metadata read from a re-downloaded page. */
export interface PageMetadata {
  /** Page title; falls back to the URL when the page carries none. Always set. */
  title: string;
  /** Site / publication name, if present. */
  site_name: string | null;
  /** Author, if present. */
  author: string | null;
  /** Publication timestamp, if present. */
  published_at: string | null;
  /** Document language (`<html lang>`), if present. */
  lang: string | null;
}

/** The clean body and derived metadata of one parsed page. */
export interface ParsedPage {
  /** Main-content markdown (boilerplate pruned); the raw HTML when extraction degrades. */
  body_markdown: string;
  metadata: PageMetadata;
}

/** Defuddle returns "" for absent string fields; normalise those to null. */
function or_null(value: string): string | null {
  return value && value.length > 0 ? value : null;
}

/**
 * Extracts clean main-content markdown and derived metadata from re-downloaded
 * public HTML. On an empty extraction or a parser failure it degrades to the
 * raw HTML body rather than dropping the page; the metadata then carries only
 * the URL as title.
 *
 * @param html - The re-downloaded public HTML.
 * @param url - The page URL; resolves relative links and is the title fallback.
 */
export async function parse_page(html: string, url: string): Promise<ParsedPage> {
  try {
    const { Defuddle } = load_defuddle();
    const response = await Defuddle(html, url, {
      markdown: true,
      useAsync: false,
    });
    const body = response.content.trim();
    return {
      body_markdown: body.length > 0 ? body : html,
      metadata: {
        title: response.title.trim() || url,
        site_name: or_null(response.site),
        author: or_null(response.author),
        published_at: or_null(response.published),
        lang: or_null(response.language),
      },
    };
  } catch (error) {
    // Degrade rather than lose the page. Log without the URL — the extension
    // host console persists to plaintext and URLs are sensitive metadata
    // (matching the convention in corpus.ts).
    console.error("main-content extraction failed:", error);
    return {
      body_markdown: html,
      metadata: {
        title: url,
        site_name: null,
        author: null,
        published_at: null,
        lang: null,
      },
    };
  }
}
