import {
  render_note_stub,
  parse_citations,
  compute_lineage_key,
  compute_stub_filename,
  compute_stub_fingerprint,
  iso_week,
  slug,
} from "./note_stub";
import { make_cluster_detail } from "./__fixtures__/cluster_detail";

const CTX = { run_id: "7f3ac12", generated_at: "2026-06-22T08:03:11.000Z" };

describe("note_stub renderer", () => {
  it("renders frontmatter, H1, scope line, summary, and member citations", () => {
    const { markdown } = render_note_stub(make_cluster_detail(), CTX);
    expect(markdown).toContain("bergamot_agent_authored: true");
    expect(markdown).toContain("run_id: 7f3ac12");
    expect(markdown).toContain("generated_at: 2026-06-22T08:03:11.000Z");
    expect(markdown).toContain("window_start: 2026-06-16T08:00:00.000Z");
    expect(markdown).toContain("# Local graph clustering");
    expect(markdown).toContain("Scope: arxiv.org, github.com +2 sites · 2026-06-16 → 2026-06-22");
    expect(markdown).toMatch(/^>.*cohered around Local graph clustering/m);
    expect(markdown).toContain("## Pages in this thread");
    expect(markdown).toContain(
      "<!-- bergamot:cite page_session_id=ps_exemplar url=https://arxiv.org/abs/hdbscan -->",
    );
  });

  it("emits keyphrases as YAML tags", () => {
    const { markdown } = render_note_stub(make_cluster_detail(), CTX);
    expect(markdown).toContain("tags:\n  - hdbscan\n  - graph-clustering\n  - embeddings");
  });

  it("pins the exemplar first and labels it", () => {
    const { markdown } = render_note_stub(make_cluster_detail(), CTX);
    const pages = markdown.slice(markdown.indexOf("## Pages"));
    const first = pages.indexOf("HDBSCAN density clustering");
    const second = pages.indexOf("Leiden vs Louvain");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(markdown).toContain("(exemplar, pinned)");
  });

  it("falls back to URL as link text when a member has no title", () => {
    const { markdown } = render_note_stub(make_cluster_detail(), CTX);
    expect(markdown).toContain("[https://distill.pub/embeddings](https://distill.pub/embeddings)");
  });

  it("H1 falls back: headline empty -> display_label", () => {
    const { markdown } = render_note_stub(
      make_cluster_detail({ headline_title: "" }),
      CTX,
    );
    expect(markdown).toContain("# Local graph clustering — arxiv.org +2 sites");
  });

  it("cited_page_session_ids lists every member", () => {
    const { cited_page_session_ids } = render_note_stub(make_cluster_detail(), CTX);
    expect(cited_page_session_ids).toEqual(["ps_exemplar", "ps_leiden", "ps_survey"]);
  });

  describe("lineage / filename", () => {
    it("filename is YYYY-Wnn--slug.md", () => {
      expect(compute_stub_filename(make_cluster_detail())).toMatch(
        /^\d{4}-W\d{2}--local-graph-clustering\.md$/,
      );
    });

    it("iso_week computes the ISO week label", () => {
      expect(iso_week("2026-06-16T08:00:00.000Z")).toBe("2026-W25");
      expect(iso_week("2021-01-01T00:00:00.000Z")).toBe("2020-W53");
    });

    it("slug lowercases, dashes non-alphanumerics, trims, caps length", () => {
      expect(slug("Hello, World! 2026")).toBe("hello-world-2026");
      expect(slug("a".repeat(80)).length).toBeLessThanOrEqual(60);
    });

    it("empty label -> exemplar-anchored fallback lineage", () => {
      const key = compute_lineage_key(
        make_cluster_detail({ headline_title: "", display_label: "" }),
      );
      expect(key).toMatch(/--cluster-ps_exemplar$/);
    });
  });

  describe("fingerprint", () => {
    it("is stable across run_id / generated_at and member order", () => {
      const a = compute_stub_fingerprint(make_cluster_detail());
      const b = compute_stub_fingerprint(make_cluster_detail());
      expect(a).toBe(b);
    });

    it("changes when content (size) changes", () => {
      const a = compute_stub_fingerprint(make_cluster_detail());
      const b = compute_stub_fingerprint(make_cluster_detail({ size: 9 }));
      expect(a).not.toBe(b);
    });
  });

  describe("parse_citations", () => {
    it("round-trips the citations the renderer emits", () => {
      const { markdown } = render_note_stub(make_cluster_detail(), CTX);
      const cites = parse_citations(markdown);
      expect(cites).toContainEqual({
        page_session_id: "ps_exemplar",
        url: "https://arxiv.org/abs/hdbscan",
      });
      expect(cites).toHaveLength(3);
    });

    it("ignores non-citation comments", () => {
      expect(parse_citations("<!-- just a note -->\ntext")).toEqual([]);
    });
  });
});
