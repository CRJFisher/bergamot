import { read_metadata } from "./read_metadata";

/** Cheap, deterministic <head> metadata extraction — regex scan, no DOM library. */
describe("read_metadata", () => {
  it("reads title, site, author, date and lang from the head", () => {
    const html = `<html lang="fr">
      <head>
        <title>Le Titre</title>
        <meta property="og:site_name" content="Mon Site">
        <meta name="author" content="Jean Dupont">
        <meta property="article:published_time" content="2025-12-01T10:00:00Z">
      </head><body>x</body></html>`;
    const meta = read_metadata(html, "https://x.test/p");
    expect(meta).toEqual({
      title: "Le Titre",
      site_name: "Mon Site",
      author: "Jean Dupont",
      published_at: "2025-12-01T10:00:00Z",
      lang: "fr",
    });
  });

  it("decodes HTML entities in the title", () => {
    const html = `<head><title>Tom &amp; Jerry &#8212; &quot;fun&quot;</title></head>`;
    expect(read_metadata(html, "u").title).toBe('Tom & Jerry — "fun"');
  });

  it("handles attributes in any order and single quotes", () => {
    const html = `<head><meta content='Acme' property='og:site_name'></head>`;
    expect(read_metadata(html, "u").site_name).toBe("Acme");
  });

  it("falls back to og:title then the URL when no <title>", () => {
    const og = `<head><meta property="og:title" content="OG Title"></head>`;
    expect(read_metadata(og, "u").title).toBe("OG Title");
    expect(read_metadata("<head></head>", "https://x.test/p").title).toBe(
      "https://x.test/p"
    );
  });

  it("returns null for absent optional fields", () => {
    const meta = read_metadata("<head><title>T</title></head>", "u");
    expect(meta.site_name).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.published_at).toBeNull();
    expect(meta.lang).toBeNull();
  });

  // Regression: out-of-range numeric entities must not throw (poison-pill risk).
  it("leaves out-of-range numeric entities verbatim without throwing", () => {
    expect(read_metadata("<head><title>A &#999999999; B &#xFFFFFFFF; C</title></head>", "u").title).toBe(
      "A &#999999999; B &#xFFFFFFFF; C"
    );
  });

  // Regression: single-pass decode — already-escaped text is not re-decoded.
  it("does not over-decode double-encoded entity text", () => {
    expect(read_metadata("<head><title>Tom &amp;lt; Jerry</title></head>", "u").title).toBe(
      "Tom &lt; Jerry"
    );
  });
});
