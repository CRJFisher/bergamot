/**
 * The batched page-vector embed pass — vectorises re-downloadable public pages
 * AHEAD of a TDT clustering run, never on the capture hot path.
 *
 * Event-loop safety: the pass is a plain async loop rather than a worker thread.
 * Inference runs in `onnxruntime-node`, whose `run()` executes off the JS event
 * loop on libuv's threadpool; the only on-loop work is light tokenization and
 * the DB await. A `setImmediate` yield between pages lets the capture `/visit`
 * endpoint and the UI interleave even across a long backlog. A worker thread
 * could not hold the single-writer DuckDB to read the corpus or write the store
 * anyway.
 */
import { resolve_page_vector } from "@bergamot/tdt";
import type {
  EmbedFn,
  PageContent,
  PageRepr,
  PageVectorConfig,
  VectorStore,
} from "@bergamot/tdt";
import type { ContentCorpus, CorpusContent } from "../redownload/corpus";

/** Per-page outcome counts; `scanned` is the sum of the rest. Never-cluster
 *  origins never appear: the corpus drops them upstream, before re-download, so
 *  they are not even scanned. */
export interface EmbedPassReport {
  scanned: number;
  embedded: number;
  /** Already vectorised under the current model id: cache hit, no embed. */
  skipped: number;
  /** No extractable text / degenerate vector: nothing stored. */
  excluded: number;
  /** Embed or store raised; isolated so the pass continues. */
  failed: number;
}

function yield_to_event_loop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The minimal projection TDT embeds — drops the fetch-fidelity metadata. */
function to_page_content(content: CorpusContent): PageContent {
  return {
    page_session_id: content.page_session_id,
    title: content.title,
    content: content.content,
  };
}

/**
 * Vectorise every re-downloadable public page missing a current-model vector.
 *
 * `embedding_model_id` is the cache key, composed of model + dim + repr-rule
 * version, so a repr change invalidates without colliding with another model.
 * `exclude_origins` are registrable domains the user never wants clustered: the
 * corpus drops their pages BEFORE re-download, so a blocked origin is never
 * re-fetched or vectorised.
 */
export async function run_embed_pass(
  corpus: ContentCorpus,
  vector_store: VectorStore,
  embed: EmbedFn,
  embedding_model_id: string,
  repr: PageRepr,
  config: PageVectorConfig,
  exclude_origins: ReadonlySet<string> = new Set(),
): Promise<EmbedPassReport> {
  const report: EmbedPassReport = {
    scanned: 0,
    embedded: 0,
    skipped: 0,
    excluded: 0,
    failed: 0,
  };

  for await (const content of corpus.iter_public_pages(exclude_origins)) {
    report.scanned++;
    try {
      // resolve_page_vector owns the get-skip / build-on-miss / exclude
      // semantics; the extra pre-read only lets the report tell a cache hit
      // apart from a fresh build:
      //   cached != null              -> skipped  (resolve returned it, no embed)
      //   cached == null, vec null    -> excluded (no-text / degenerate)
      //   cached == null, vec != null -> embedded (built + stored this pass)
      const cached = await vector_store.get(
        content.page_session_id,
        embedding_model_id,
      );
      const vector = await resolve_page_vector(
        to_page_content(content),
        embed,
        vector_store,
        embedding_model_id,
        repr,
        config,
      );
      if (cached !== null) report.skipped++;
      else if (vector === null) report.excluded++;
      else report.embedded++;
    } catch (error) {
      // One bad page must not abort the backlog. Only the opaque session id is
      // logged — URLs and content are sensitive metadata.
      report.failed++;
      console.error(
        `embed pass failed for page session ${content.page_session_id}:`,
        error,
      );
    }
    await yield_to_event_loop();
  }

  return report;
}
