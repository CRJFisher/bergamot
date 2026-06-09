import * as fs from "fs";
import * as path from "path";
import { PageMetadata } from "../read_metadata";

/**
 * A committed raw-page fixture with its expected cheap `<head>` metadata. Used
 * by the deterministic `read_metadata` eval — fully deterministic and offline.
 */
export interface ReadMetadataFixture {
  name: string;
  url: string;
  /** The raw page, read from the committed fixture file. */
  html: string;
  /** Expected cheap <head> metadata. */
  expected_metadata: PageMetadata;
}

function read_fixture(file: string): string {
  return fs.readFileSync(path.join(__dirname, "read_metadata", file), "utf-8");
}

export const READ_METADATA_FIXTURES: ReadMetadataFixture[] = [
  {
    name: "article",
    url: "https://blog.example.com/zstd",
    html: read_fixture("article.html"),
    expected_metadata: {
      title: "How zstd Compression Works & Why It Matters",
      site_name: "Bergamot Engineering Blog",
      author: "Ada Lovelace",
      published_at: "2026-02-14T09:30:00Z",
      lang: "en",
    },
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
  },
];
