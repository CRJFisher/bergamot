import { compute_clusters } from "./cluster_pipeline";
import type { PageVector, VisitRow } from "./types";
import { DEFAULT_HDBSCAN_CONFIG } from "./config";

function l2_normalize(parts: number[]): Float32Array {
  let norm = 0;
  for (const x of parts) norm += x * x;
  norm = Math.sqrt(norm);
  return Float32Array.from(parts, (x) => x / norm);
}

function unit_vector(id: string, parts: number[]): PageVector {
  return { page_session_id: id, vector: l2_normalize(parts), low_confidence: false };
}

function t(d: number): string {
  return new Date(Date.UTC(2024, 0, d, 0, 0, 0)).toISOString();
}

function visit(id: string, url: string, title: string): VisitRow {
  return { page_session_id: id, url, title, site_name: null, page_loaded_at: t(Number(id.slice(1)) + 1), tree_id: "t1" };
}

// Two tight, well-separated clusters of 3 plus one outlier, in a 5-d space.
function two_cluster_window(): { visits: VisitRow[]; vectors: PageVector[] } {
  const specs: [string, number[]][] = [
    ["p0", [1, 0, 0, 0, 0]],
    ["p1", [0.98, 0.05, 0.02, 0, 0]],
    ["p2", [0.99, 0.02, 0, 0.01, 0]],
    ["p3", [0, 1, 0, 0, 0]],
    ["p4", [0.02, 0.98, 0.05, 0, 0]],
    ["p5", [0, 0.99, 0.02, 0.01, 0]],
    ["p6", [0, 0, 0, 0, 1]],
  ];
  const vectors = specs.map(([id, parts]) => unit_vector(id, parts));
  const visits = specs.map(([id], i) => visit(id, `https://site${i < 3 ? "a" : "b"}.com/${id}`, `Title ${id}`));
  return { visits, vectors };
}

describe("compute_clusters", () => {
  it("clusters a window end to end, aligning labels, representations, and labels (AC#1)", async () => {
    const { visits, vectors } = two_cluster_window();

    const out = await compute_clusters({
      visits,
      vectors,
      hdbscan: { ...DEFAULT_HDBSCAN_CONFIG, min_cluster_size: 3, min_samples: 2 },
      max_samples: 4000,
    });

    expect(out.labels).toHaveLength(visits.length);
    expect(out.probabilities).toHaveLength(visits.length);
    expect(out.cluster_labels).toHaveLength(out.represented.length);
    // The two dense groups separate; the lone p6 is rejected as noise (-1).
    const cluster_count = new Set(out.labels.filter((l) => l >= 0)).size;
    expect(cluster_count).toBeGreaterThanOrEqual(2);
    expect(out.labels).toContain(-1);
    expect(out.algo_version).toMatch(/^hdbscan-1#clustering-tfjs@/);
    for (const rc of out.represented) {
      expect(rc.representative_vector).toHaveLength(5);
      let norm = 0;
      for (const x of rc.representative_vector) norm += x * x;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    }
  });

  it("labels each cluster from its member titles and domains via the deterministic labeler", async () => {
    const { visits, vectors } = two_cluster_window();

    const out = await compute_clusters({
      visits,
      vectors,
      hdbscan: { ...DEFAULT_HDBSCAN_CONFIG, min_cluster_size: 3, min_samples: 2 },
      max_samples: 4000,
    });

    expect(out.cluster_labels.length).toBeGreaterThanOrEqual(2);
    for (const label of out.cluster_labels) {
      expect(label.representation_version).toBe("det-1");
      expect(label.headline_title).toMatch(/^Title p\d$/);
      // The pipeline threads the real visits through: scope is the member domain
      // (sitea.com / siteb.com), keyphrases the lowercased non-stopword title tokens.
      expect(label.scope).toMatch(/^site[ab]\.com$/);
      expect(label.keyphrases).toContain("title");
      expect(label.display_label).toBe(`${label.headline_title} — ${label.scope}`);
    }
  });

  it("threads labeler_config through to the deterministic labeler", async () => {
    const { visits, vectors } = two_cluster_window();

    const out = await compute_clusters({
      visits,
      vectors,
      hdbscan: { ...DEFAULT_HDBSCAN_CONFIG, min_cluster_size: 3, min_samples: 2 },
      max_samples: 4000,
      // "title" is the only non-stopword title token; stopwording it leaves none.
      labeler_config: {
        top_k_domains: 1,
        max_keyphrases: 5,
        min_token_len: 3,
        stopwords: new Set(["title"]),
      },
    });

    for (const label of out.cluster_labels) {
      expect(label.keyphrases).toEqual([]);
    }
  });

  it("is deterministic: identical input yields identical labels and probabilities", async () => {
    const a = two_cluster_window();
    const b = two_cluster_window();
    const config = { ...DEFAULT_HDBSCAN_CONFIG, min_cluster_size: 3, min_samples: 2 };

    const out_a = await compute_clusters({ visits: a.visits, vectors: a.vectors, hdbscan: config, max_samples: 4000 });
    const out_b = await compute_clusters({ visits: b.visits, vectors: b.vectors, hdbscan: config, max_samples: 4000 });

    expect(out_b.labels).toEqual(out_a.labels);
    expect(out_b.probabilities).toEqual(out_a.probabilities);
  });
});
