import { parse_page } from "./main_content";

/**
 * Unit behaviour of {@link parse_page} at the edges: it must never drop a page
 * (degrading to raw HTML when extraction yields nothing) and must normalise
 * Defuddle's empty-string metadata to null.
 */
describe("parse_page", () => {
  it("extracts clean markdown and metadata from a normal page", async () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>Hello World</title>
      <meta name="author" content="Grace Hopper">
      <meta property="og:site_name" content="Example Site">
      <meta property="article:published_time" content="2026-03-01T00:00:00Z">
      </head><body>
      <header><nav><a href="/about">About</a></nav></header>
      <main><article><h1>Hello World</h1>
      <p>This is the substantive article body that should survive extraction.</p>
      </article></main>
      <footer>Copyright 2026 — all rights reserved</footer>
      </body></html>`;
    const { body_markdown, metadata } = await parse_page(
      html,
      "https://example.com/post"
    );

    expect(body_markdown).toContain("substantive article body");
    expect(body_markdown).not.toContain("Copyright 2026");
    expect(body_markdown).not.toContain("/about");
    expect(metadata).toEqual({
      title: "Hello World",
      site_name: "Example Site",
      author: "Grace Hopper",
      published_at: "2026-03-01T00:00:00Z",
      lang: "en",
    });
  });

  it("normalises absent metadata fields to null and falls back to the URL title", async () => {
    const html =
      "<html><body><article><p>Body text with enough words to extract cleanly here.</p></article></body></html>";
    const { metadata } = await parse_page(html, "https://example.com/x");

    expect(metadata.title).toBe("https://example.com/x");
    expect(metadata.author).toBeNull();
    expect(metadata.published_at).toBeNull();
    expect(metadata.site_name).toBeNull();
    expect(metadata.lang).toBeNull();
  });

  it("degrades to the raw input when there is no extractable content", async () => {
    // The parser logs the failure; silence it so the expected degrade path does
    // not print an error during a passing test.
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = "   ";
      const { body_markdown } = await parse_page(
        html,
        "https://example.com/empty"
      );
      expect(body_markdown).toBe(html);
    } finally {
      logged.mockRestore();
    }
  });
});
