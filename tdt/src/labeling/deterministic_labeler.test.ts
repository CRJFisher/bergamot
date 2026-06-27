import {
  label_cluster,
  compose_display_label,
  LABELER_VERSION,
  DEFAULT_LABELER_CONFIG,
} from "./deterministic_labeler";
import type { RepresentedCluster, VisitRow } from "../types";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function t(y: number, mo: number, d: number): string {
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).toISOString();
}

function visit(id: string, url: string, title: string | null): VisitRow {
  return { page_session_id: id, url, title, site_name: null, page_loaded_at: t(2024, 1, 1), tree_id: "t1" };
}

// A RepresentedCluster whose member_indices / representative_index point into a
// visits array the test supplies in parallel (the same alignment the labeler and
// represent_clusters share). The vector is a dummy — the labeler never reads it.
function cluster(member_indices: number[], representative_index: number): RepresentedCluster {
  return {
    local_label: 0,
    member_indices,
    representative_index,
    representative_vector: new Float32Array([1, 0, 0]),
    size: member_indices.length,
    time_span: { start: t(2024, 1, 1), end: t(2024, 1, 2) },
  };
}

// ---------------------------------------------------------------------------
// Separate fields, no baked string (AC#2)
// ---------------------------------------------------------------------------

describe("label_cluster — separate fields (AC#2)", () => {
  const visits = [
    visit("p0", "https://nextjs.org/docs", "Server components"),
    visit("p1", "https://nextjs.org/learn", "Server components tutorial"),
  ];

  it("returns headline_title, scope, keyphrases, display_label and representation_version as distinct fields (AC#2)", () => {
    const label = label_cluster(cluster([0, 1], 0), visits);
    expect(typeof label.headline_title).toBe("string");
    expect(typeof label.scope).toBe("string");
    expect(Array.isArray(label.keyphrases)).toBe(true);
    expect(typeof label.display_label).toBe("string");
    expect(typeof label.representation_version).toBe("string");
  });

  it("sets headline_title to the exemplar page's title (AC#2)", () => {
    expect(label_cluster(cluster([0, 1], 0), visits).headline_title).toBe("Server components");
    expect(label_cluster(cluster([0, 1], 1), visits).headline_title).toBe("Server components tutorial");
  });

  it("stamps representation_version with the labeler version, stable across calls (AC#2)", () => {
    expect(label_cluster(cluster([0, 1], 0), visits).representation_version).toBe(LABELER_VERSION);
    expect(label_cluster(cluster([0, 1], 0), visits).representation_version).toBe(LABELER_VERSION);
  });
});

// ---------------------------------------------------------------------------
// scope via registrable domain (AC#2)
// ---------------------------------------------------------------------------

describe("label_cluster — scope via registrable domain (AC#2)", () => {
  it("collapses subdomains of one site to a single registrable domain (AC#2)", () => {
    const visits = [
      visit("p0", "https://docs.google.com/a", "A"),
      visit("p1", "https://mail.google.com/b", "B"),
      visit("p2", "https://drive.google.com/c", "C"),
    ];
    expect(label_cluster(cluster([0, 1, 2], 0), visits).scope).toBe("google.com");
  });

  it("uses the eTLD+1 for a multi-level public suffix like foo.co.uk (AC#2)", () => {
    const visits = [visit("p0", "https://shop.foo.co.uk/x", "X"), visit("p1", "https://www.foo.co.uk/y", "Y")];
    expect(label_cluster(cluster([0, 1], 0), visits).scope).toBe("foo.co.uk");
  });

  it("renders a multi-domain cluster as '<primary> +<N> sites' by page count (AC#2)", () => {
    const visits = [
      visit("p0", "https://nextjs.org/a", "A"),
      visit("p1", "https://nextjs.org/b", "B"),
      visit("p2", "https://nextjs.org/c", "C"),
      visit("p3", "https://react.dev/d", "D"),
      visit("p4", "https://vercel.com/e", "E"),
    ];
    expect(label_cluster(cluster([0, 1, 2, 3, 4], 0), visits).scope).toBe("nextjs.org +2 sites");
  });

  it("uses the singular '+1 site' for exactly one extra domain (AC#2)", () => {
    const visits = [
      visit("p0", "https://nextjs.org/a", "A"),
      visit("p1", "https://nextjs.org/b", "B"),
      visit("p2", "https://react.dev/c", "C"),
    ];
    expect(label_cluster(cluster([0, 1, 2], 0), visits).scope).toBe("nextjs.org +1 site");
  });

  it("names top_k_domains domains joined by ', ' before the '+N sites' tail (AC#2)", () => {
    const visits = [
      visit("p0", "https://nextjs.org/a", "A"),
      visit("p1", "https://nextjs.org/b", "B"),
      visit("p2", "https://react.dev/c", "C"),
      visit("p3", "https://vercel.com/d", "D"),
    ];
    const config = { ...DEFAULT_LABELER_CONFIG, top_k_domains: 2 };
    expect(label_cluster(cluster([0, 1, 2, 3], 0), visits, config).scope).toBe("nextjs.org, react.dev +1 site");
  });

  it("yields scope='' when no member URL parses to a registrable domain (AC#2)", () => {
    const visits = [
      visit("p0", "http://localhost:3000/x", "X"),
      visit("p1", "about:blank", "Y"),
      visit("p2", "not-a-url", "Z"),
    ];
    expect(label_cluster(cluster([0, 1, 2], 0), visits).scope).toBe("");
  });

  it("drops unparseable URLs but still scopes the parseable ones (AC#2)", () => {
    const visits = [visit("p0", "http://localhost:3000/x", "X"), visit("p1", "https://github.com/a/b", "Y")];
    expect(label_cluster(cluster([0, 1], 0), visits).scope).toBe("github.com");
  });
});

// ---------------------------------------------------------------------------
// keyphrases from title term-frequency (AC#2)
// ---------------------------------------------------------------------------

describe("label_cluster — keyphrases from title term-frequency (AC#2)", () => {
  it("ranks frequent title terms as keyphrases (AC#2)", () => {
    const visits = [
      visit("p0", "https://x.com/0", "React hooks tutorial"),
      visit("p1", "https://x.com/1", "React hooks patterns"),
      visit("p2", "https://x.com/2", "Understanding React"),
    ];
    const kp = label_cluster(cluster([0, 1, 2], 0), visits).keyphrases;
    expect(kp[0]).toBe("react"); // count 3, the clear leader
    expect(kp).toContain("hooks");
  });

  it("removes stopwords and short tokens (AC#2)", () => {
    const visits = [visit("p0", "https://x.com/0", "the and for react"), visit("p1", "https://x.com/1", "react io")];
    const kp = label_cluster(cluster([0, 1], 0), visits).keyphrases;
    expect(kp).toEqual(["react"]); // "the"/"and"/"for" are stopwords; "io" is < 3 chars
  });

  it("breaks frequency ties by code-unit order (AC#2)", () => {
    const visits = [visit("p0", "https://x.com/0", "omega alpha"), visit("p1", "https://x.com/1", "omega alpha")];
    const kp = label_cluster(cluster([0, 1], 0), visits).keyphrases;
    expect(kp).toEqual(["alpha", "omega"]); // both count 2 → alphabetical
  });

  it("merges case variants via locale-independent lowercasing (AC#2)", () => {
    const visits = [visit("p0", "https://x.com/0", "React"), visit("p1", "https://x.com/1", "react REACT")];
    const kp = label_cluster(cluster([0, 1], 0), visits).keyphrases;
    expect(kp).toEqual(["react"]); // one term, count 3
  });

  it("returns an empty keyphrases array when every member title is empty (AC#2)", () => {
    const visits = [visit("p0", "https://x.com/0", ""), visit("p1", "https://x.com/1", "")];
    expect(label_cluster(cluster([0, 1], 0), visits).keyphrases).toEqual([]);
  });

  it("caps keyphrases at max_keyphrases (AC#2)", () => {
    const visits = [visit("p0", "https://x.com/0", "alpha beta gamma delta epsilon zeta eta theta")];
    const kp = label_cluster(cluster([0], 0), visits).keyphrases;
    expect(kp).toHaveLength(DEFAULT_LABELER_CONFIG.max_keyphrases);
  });

  it("honors a custom config's max_keyphrases, min_token_len and stopwords (AC#2)", () => {
    const visits = [visit("p0", "https://x.com/0", "alpha beta gamma alpha to go")];
    const config = {
      ...DEFAULT_LABELER_CONFIG,
      max_keyphrases: 2,
      min_token_len: 2,
      stopwords: new Set<string>(["beta"]),
    };
    const kp = label_cluster(cluster([0], 0), visits, config).keyphrases;
    expect(kp).toEqual(["alpha", "gamma"]);
  });

  it("depends only on the cluster's own titles, not on any window corpus (AC#2)", () => {
    // The signature carries no corpus/window argument, so keyphrases cannot be
    // window-relative (c-TF-IDF): identical member titles → identical keyphrases.
    const visits = [visit("p0", "https://x.com/0", "vector search index"), visit("p1", "https://x.com/1", "vector store")];
    const a = label_cluster(cluster([0, 1], 0), visits).keyphrases;
    const b = label_cluster(cluster([0, 1], 0), visits).keyphrases;
    expect(a).toEqual(b);
    expect(a[0]).toBe("vector");
  });
});

// ---------------------------------------------------------------------------
// Empty / degenerate inputs (AC#2)
// ---------------------------------------------------------------------------

describe("label_cluster — empty inputs (AC#2)", () => {
  it("yields headline_title='' from a null exemplar title without throwing (AC#2)", () => {
    const visits = [visit("p0", "https://github.com/a", null), visit("p1", "https://github.com/b", null)];
    const label = label_cluster(cluster([0, 1], 0), visits);
    expect(label.headline_title).toBe("");
    expect(label.scope).toBe("github.com");
  });

  it("strips surrounding whitespace from the exemplar title (AC#2)", () => {
    const visits = [visit("p0", "https://github.com/a", "  React hooks  "), visit("p1", "https://github.com/b", null)];
    expect(label_cluster(cluster([0, 1], 0), visits).headline_title).toBe("React hooks");
  });

  it("trims a whitespace-only exemplar title to '' and falls through (AC#2)", () => {
    const visits = [visit("p0", "https://github.com/a", "   "), visit("p1", "https://github.com/b", "code review")];
    const label = label_cluster(cluster([0, 1], 0), visits);
    expect(label.headline_title).toBe("");
    // headline empty → display_label falls through to keyphrases + scope.
    expect(label.display_label).toBe("code, review — github.com");
  });

  it("produces a defined display_label even with no title, keyphrases or scope (AC#2)", () => {
    const visits = [visit("p0", "about:blank", null), visit("p1", "not-a-url", null)];
    const label = label_cluster(cluster([0, 1], 0), visits);
    expect(label.display_label).toBe("Untitled cluster");
  });
});

// ---------------------------------------------------------------------------
// compose_display_label — pure composition (AC#3)
// ---------------------------------------------------------------------------

describe("compose_display_label — pure composition (AC#3)", () => {
  it("joins a title part and scope with an em-dash (AC#3)", () => {
    expect(compose_display_label("Server components", "nextjs.org +2 sites", ["react"])).toBe(
      "Server components — nextjs.org +2 sites",
    );
  });

  it("uses keyphrases as the title part when the headline is empty (AC#3)", () => {
    expect(compose_display_label("", "github.com", ["vector", "search"])).toBe("vector, search — github.com");
  });

  it("falls back to scope alone when title part is empty (AC#3)", () => {
    expect(compose_display_label("", "github.com", [])).toBe("github.com");
  });

  it("drops the scope tail when scope is empty (AC#3)", () => {
    expect(compose_display_label("Title", "", ["x"])).toBe("Title");
  });

  it("returns a fixed placeholder when everything is empty (AC#3)", () => {
    expect(compose_display_label("", "", [])).toBe("Untitled cluster");
  });

  it("is pure — identical args yield an identical string (AC#3)", () => {
    const a = compose_display_label("T", "github.com", ["x"]);
    const b = compose_display_label("T", "github.com", ["x"]);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Recomposition + determinism (AC#3)
// ---------------------------------------------------------------------------

describe("label recomposition and determinism (AC#3)", () => {
  const cases: Array<{ name: string; visits: VisitRow[]; c: RepresentedCluster }> = [
    {
      name: "single-domain",
      visits: [visit("p0", "https://nextjs.org/a", "Server components"), visit("p1", "https://nextjs.org/b", "Routing")],
      c: cluster([0, 1], 0),
    },
    {
      name: "multi-domain",
      visits: [
        visit("p0", "https://nextjs.org/a", "Edge runtime"),
        visit("p1", "https://react.dev/b", "Edge cases"),
        visit("p2", "https://vercel.com/c", "Edge config"),
      ],
      c: cluster([0, 1, 2], 0),
    },
    {
      name: "empty",
      visits: [visit("p0", "about:blank", null), visit("p1", "not-a-url", null)],
      c: cluster([0, 1], 0),
    },
  ];

  it.each(cases)("recomposes display_label from the stored fields — $name (AC#3)", ({ visits, c }) => {
    const label = label_cluster(c, visits);
    expect(compose_display_label(label.headline_title, label.scope, label.keyphrases)).toBe(label.display_label);
  });

  it.each(cases)("is deterministic — identical input yields an identical bundle — $name (AC#3)", ({ visits, c }) => {
    expect(JSON.stringify(label_cluster(c, visits))).toBe(JSON.stringify(label_cluster(c, visits)));
  });

  it("is independent of member input order (AC#3)", () => {
    const visits = [
      visit("p0", "https://nextjs.org/a", "Edge runtime guide"),
      visit("p1", "https://react.dev/b", "Edge runtime notes"),
      visit("p2", "https://nextjs.org/c", "Runtime guide"),
    ];
    const forward = label_cluster(cluster([0, 1, 2], 0), visits);
    const reversed = label_cluster(cluster([2, 1, 0], 0), visits);
    expect(reversed.scope).toBe(forward.scope);
    expect(reversed.keyphrases).toEqual(forward.keyphrases);
    expect(reversed.display_label).toBe(forward.display_label);
  });
});
