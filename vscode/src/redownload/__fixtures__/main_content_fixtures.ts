import * as fs from "fs";
import * as path from "path";
import { PageMetadata } from "../main_content";

/**
 * A committed raw-page fixture with the metadata and body shape expected from a
 * single {@link parse_page} pass. Used by the deterministic main-content eval —
 * fully deterministic and offline (Defuddle reads no network with
 * `useAsync: false`).
 */
export interface MainContentFixture {
  name: string;
  url: string;
  /** The raw page, read from the committed fixture file. */
  html: string;
  /** Expected derived metadata. */
  expected_metadata: PageMetadata;
  /** Substrings the extracted main-content markdown must contain. */
  expected_in_body: string[];
  /** Boilerplate substrings the extraction must prune from the body. */
  expected_pruned: string[];
}

function read_fixture(file: string): string {
  return fs.readFileSync(
    path.join(__dirname, "main_content_pages", file),
    "utf-8"
  );
}

export const MAIN_CONTENT_FIXTURES: MainContentFixture[] = [
  {
    name: "article",
    url: "https://blog.example.com/zstd",
    html: read_fixture("article.html"),
    expected_metadata: {
      title: "How zstd Compression Works",
      site_name: "Bergamot Engineering Blog",
      author: "Ada Lovelace",
      published_at: "2026-02-14T09:30:00Z",
      lang: "en",
    },
    expected_in_body: [
      "Zstandard, usually shortened to zstd",
      "Dictionaries are another important feature",
    ],
    // Nav (header), aside (newsletter), ad container, social-share widget, and
    // footer are all pruned — none of their boilerplate reaches the body.
    expected_pruned: [
      "/blog",
      "NEWSLETTER_BOILERPLATE",
      "AD_BOILERPLATE",
      "twitter.com/intent",
      "FOOTER_BOILERPLATE",
    ],
  },
  {
    name: "docs_with_nav",
    url: "https://docs.example.com/api/configure",
    html: read_fixture("docs_with_nav.html"),
    expected_metadata: {
      title: "configure() — Bergamot API Reference",
      site_name: "Bergamot Docs",
      author: null,
      published_at: null,
      lang: "en",
    },
    expected_in_body: [
      "The `configure()` function sets the runtime options",
      "Return value",
    ],
    // The sidebar nav is pruned: its unique link text and hrefs are gone.
    expected_pruned: ["Relevance Gate", "/docs/faq"],
  },
  {
    name: "nav_heavy",
    url: "https://shop.example.com/sitemap",
    html: read_fixture("nav_heavy.html"),
    expected_metadata: {
      title: "Site Map",
      site_name: "MegaShop",
      author: null,
      published_at: null,
      lang: "en",
    },
    // A genuinely link-dense sitemap IS the content — it must be kept, not
    // over-pruned as navigation chrome.
    expected_in_body: ["Electronics", "Today's Deals"],
    expected_pruned: [],
  },
  {
    name: "aggregator",
    url: "https://news.example.com/",
    html: read_fixture("aggregator.html"),
    expected_metadata: {
      title: "Top Stories",
      site_name: "LinkNews",
      author: null,
      published_at: null,
      lang: "en",
    },
    expected_in_body: [
      "deterministic capture pipeline",
      "Embeddings are not your source of truth",
    ],
    expected_pruned: [],
  },
];
