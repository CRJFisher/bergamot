/**
 * The batched page-vector embed pass (TASK-36.3.1) — the step that vectorises
 * re-downloadable public pages AHEAD of a TDT clustering run, never on the
 * capture hot path.
 *
 * It iterates the cache-served public corpus (`iter_public_pages()`), projects
 * each page to a {@link PageContent}, and resolves its vector through
 * `resolve_page_vector`: a page already vectorised under the current
 * `embedding_model_id` is a cache hit (no embed), a fresh page is built and
 * stored, and a page with no extractable text — or a degenerate embedding — is
 * excluded (null, never a stored zero/NaN vector). The pass is incremental: a
 * second pass over an unchanged corpus is all cache hits.
 *
 * Event-loop safety (AC #3): the pass is a plain async loop. The actual
 * inference runs in `onnxruntime-node`, whose `run()` executes off the JS event
 * loop on libuv's threadpool; the only on-loop work is light tokenization and
 * the DB await. A `setImmediate` yield between pages guarantees the capture
 * `/visit` endpoint and the UI interleave even across a long backlog — so no
 * worker thread is needed (and a worker could not hold the single-writer DuckDB
 * to read the corpus or write the store anyway).
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

/** What one embed pass did, by per-page outcome. `scanned` is their sum. */
export interface EmbedPassReport {
  /** Public pages the corpus yielded. */
  scanned: number;
  /** Pages built and stored this pass (cache miss). */
  embedded: number;
  /** Pages already vectorised under the current model id (cache hit, no embed). */
  skipped: number;
  /** Pages excluded — no extractable text / degenerate vector (nothing stored). */
  excluded: number;
  /** Pages whose embed or store raised; isolated so the pass continues. */
  failed: number;
}

/** Returns control to the event loop so other work (capture, UI) interleaves. */
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
 * @param corpus cache-served public corpus (`iter_public_pages()`)
 * @param vector_store the page-vector cache (get/put)
 * @param embed the local embedder
 * @param embedding_model_id the cache key (model + dim + repr-rule version)
 * @param repr the representation strategy whose version the id encodes
 * @param config page-vector construction knobs
 */
export async function run_embed_pass(
  corpus: ContentCorpus,
  vector_store: VectorStore,
  embed: EmbedFn,
  embedding_model_id: string,
  repr: PageRepr,
  config: PageVectorConfig,
): Promise<EmbedPassReport> {
  const report: EmbedPassReport = {
    scanned: 0,
    embedded: 0,
    skipped: 0,
    excluded: 0,
    failed: 0,
  };

  for await (const content of corpus.iter_public_pages()) {
    report.scanned++;
    try {
      // resolve_page_vector is the single source of the get-skip / build-on-miss
      // / exclude semantics; the extra cheap pre-read here only lets the report
      // tell a cache hit apart from a fresh build. The classification truth table:
      //   cached != null            -> skipped  (hit; resolve returned it, no embed)
      //   cached == null, vec null  -> excluded (no-text / degenerate; nothing stored)
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
      // Per-page isolation: one bad page must not abort the backlog. Only the
      // opaque session id is logged — URLs and content are sensitive metadata.
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
