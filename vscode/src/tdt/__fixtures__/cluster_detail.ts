import type { ClusterDetail } from "../cluster_reads";

/** A fully-populated ClusterDetail for renderer/writer tests. */
export function make_cluster_detail(
  overrides: Partial<ClusterDetail["cluster"]> = {},
): ClusterDetail {
  return {
    cluster: {
      id: "c0",
      run_id: "run-1",
      display_label: "Local graph clustering — arxiv.org +2 sites",
      renamed_label: null,
      headline_title: "Local graph clustering",
      scope: "arxiv.org, github.com +2 sites",
      keyphrases: ["hdbscan", "graph-clustering", "embeddings"],
      size: 3,
      coherence: 0.71,
      time_span: {
        start: "2026-06-16T08:00:00.000Z",
        end: "2026-06-22T20:00:00.000Z",
      },
      representation_version: "det-1",
      ...overrides,
    },
    exemplar_page: {
      page_session_id: "ps_exemplar",
      url: "https://arxiv.org/abs/hdbscan",
      title: "HDBSCAN density clustering",
      page_loaded_at: "2026-06-16T08:00:00.000Z",
    },
    members: [
      {
        page_session_id: "ps_exemplar",
        url: "https://arxiv.org/abs/hdbscan",
        title: "HDBSCAN density clustering",
        page_loaded_at: "2026-06-16T08:00:00.000Z",
        probability: 0.95,
        is_exemplar: true,
      },
      {
        page_session_id: "ps_leiden",
        url: "https://github.com/leiden",
        title: "Leiden vs Louvain",
        page_loaded_at: "2026-06-18T08:00:00.000Z",
        probability: 0.7,
        is_exemplar: false,
      },
      {
        page_session_id: "ps_survey",
        url: "https://distill.pub/embeddings",
        title: null,
        page_loaded_at: "2026-06-20T08:00:00.000Z",
        probability: 0.5,
        is_exemplar: false,
      },
    ],
  };
}
