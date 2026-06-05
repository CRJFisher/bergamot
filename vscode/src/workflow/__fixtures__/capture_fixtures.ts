import * as fs from "fs";
import * as path from "path";
import { PageMetadata } from "../read_metadata";
import { GateDecision } from "../page_gate";

/**
 * A committed raw-page fixture with its expected cheap metadata and gate label.
 * Shared by the gate unit tests (task-35.8) and the deterministic capture eval
 * (task-35.10). Fully deterministic and offline.
 */
export interface CaptureFixture {
  name: string;
  url: string;
  content_type: string;
  /** The raw captured page, read from the committed fixture file. */
  html: string;
  /** Expected cheap <head> metadata, or null when not asserted (pdf/empty). */
  expected_metadata: PageMetadata | null;
  /** Expected deterministic gate decision. */
  expected_gate: GateDecision;
}

function read_fixture(file: string): string {
  return fs.readFileSync(path.join(__dirname, "capture", file), "utf-8");
}

export const CAPTURE_FIXTURES: CaptureFixture[] = [
  {
    name: "article",
    url: "https://blog.example.com/zstd",
    content_type: "text/html",
    html: read_fixture("article.html"),
    expected_metadata: {
      title: "How zstd Compression Works & Why It Matters",
      site_name: "Bergamot Engineering Blog",
      author: "Ada Lovelace",
      published_at: "2026-02-14T09:30:00Z",
      lang: "en",
    },
    expected_gate: { keep: true },
  },
  {
    name: "docs_with_nav",
    url: "https://docs.example.com/api/configure",
    content_type: "text/html",
    html: read_fixture("docs_with_nav.html"),
    expected_metadata: {
      title: "configure() — Bergamot API Reference",
      site_name: "Bergamot Docs",
      author: null,
      published_at: null,
      lang: "en",
    },
    expected_gate: { keep: true },
  },
  {
    name: "nav_heavy",
    url: "https://shop.example.com/sitemap",
    content_type: "text/html",
    html: read_fixture("nav_heavy.html"),
    expected_metadata: {
      title: "Site Map",
      site_name: "MegaShop",
      author: null,
      published_at: null,
      lang: "en",
    },
    // Permissive gate: a nav/sitemap page is real content worth capturing.
    expected_gate: { keep: true },
  },
  {
    name: "aggregator",
    url: "https://news.example.com/",
    content_type: "text/html",
    html: read_fixture("aggregator.html"),
    expected_metadata: {
      title: "Top Stories",
      site_name: "LinkNews",
      author: null,
      published_at: null,
      lang: "en",
    },
    // Permissive gate: a link aggregator is kept; quality filtering is task-31's.
    expected_gate: { keep: true },
  },
  {
    name: "empty",
    url: "https://example.com/blank",
    content_type: "text/html",
    html: read_fixture("empty.html"),
    expected_metadata: null,
    expected_gate: { keep: false, reason: "content_empty" },
  },
  {
    name: "auth",
    url: "https://accounts.example.com/login",
    content_type: "text/html",
    html: read_fixture("auth.html"),
    expected_metadata: null,
    expected_gate: { keep: false, reason: "auth" },
  },
  {
    name: "redirect",
    url: "https://example.com/r/abc",
    content_type: "text/html",
    html: read_fixture("redirect.html"),
    expected_metadata: null,
    expected_gate: { keep: false, reason: "redirect" },
  },
];
