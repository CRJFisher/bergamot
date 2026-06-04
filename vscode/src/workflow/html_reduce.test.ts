import {
  reduce_html_for_llm,
  MAX_LLM_CONTENT_CHARS,
} from "./html_reduce";

describe("reduce_html_for_llm", () => {
  it("strips script content (e.g. a Next.js data blob) while keeping body text", () => {
    const html = `<body><h1>Title</h1><script id="__NEXT_DATA__">${"x".repeat(
      500
    )}</script><p>Article body</p></body>`;

    const { content } = reduce_html_for_llm(html);

    expect(content).toContain("Title");
    expect(content).toContain("Article body");
    expect(content).not.toContain("__NEXT_DATA__");
    expect(content).not.toContain("xxxx");
  });

  it("strips style, svg, template, and comments", () => {
    const html =
      "<style>.a{color:red}</style>" +
      "<svg><path d='M0 0'/></svg>" +
      "<template><div>hidden</div></template>" +
      "<!-- a comment -->" +
      "<p>Keep me</p>";

    const { content } = reduce_html_for_llm(html);

    expect(content).toContain("Keep me");
    expect(content).not.toContain("color:red");
    expect(content).not.toContain("M0 0");
    expect(content).not.toContain("hidden");
    expect(content).not.toContain("a comment");
  });

  it("drops base64 data: URIs but keeps http image links", () => {
    const html =
      '<img src="data:image/png;base64,AAAABBBBCCCC">' +
      '<img src="https://example.com/real.png" alt="real">';

    const { content } = reduce_html_for_llm(html);

    expect(content).not.toContain("AAAABBBBCCCC");
    expect(content).toContain("https://example.com/real.png");
  });

  it("collapses whitespace runs left by stripped elements", () => {
    const html = "<p>a</p>\n\n\n\n   \n  <script>junk</script>   <p>b</p>";

    const { content } = reduce_html_for_llm(html);

    expect(content).not.toMatch(/\n{3,}/);
    expect(content).not.toMatch(/ {2,}/);
    expect(content).toContain("a");
    expect(content).toContain("b");
  });

  it("leaves small, clean HTML unchanged in substance", () => {
    const html = "<html><body>Test content</body></html>";

    const { content, truncated } = reduce_html_for_llm(html);

    expect(content).toBe(html);
    expect(truncated).toBe(false);
  });

  it("truncates content beyond the char cap and flags it", () => {
    const html = `<body><p>${"word ".repeat(MAX_LLM_CONTENT_CHARS)}</p></body>`;

    const { content, truncated, original_length } = reduce_html_for_llm(html);

    expect(truncated).toBe(true);
    expect(content.length).toBe(MAX_LLM_CONTENT_CHARS);
    expect(original_length).toBe(html.length);
  });

  it("does not truncate content within the cap", () => {
    const html = `<body><p>${"word ".repeat(100)}</p></body>`;

    const { truncated } = reduce_html_for_llm(html);

    expect(truncated).toBe(false);
  });
});
