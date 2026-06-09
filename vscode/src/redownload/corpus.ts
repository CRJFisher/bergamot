/**
 * The re-downloadable public corpus: the content read path and the contract that
 * downstream consumers (Temporal Topic Detection — task-36; RAG — task-31) read.
 *
 * Given a stored metadata row, the corpus re-downloads its public URL through the
 * {@link Fetcher}, records the fetch (outcome + fidelity + parsed `<meta>`) to the
 * `webpage_fetch` log, and exposes the result. Only an `ok` re-download carries
 * content; authenticated, paywalled, dead, and non-HTML pages are reported as
 * unavailable, with no content. The login wall is the privacy filter — auth-walled
 * visits are trail/metadata only and are absent from this corpus.
 *
 * Re-downloaded bytes are NOT persisted here; they are returned on demand. An
 * encrypted on-demand content cache is a separate tier (task-39.3).
 */
import {
  DuckDB,
  get_webpage_capture,
  insert_webpage_fetch,
  list_capture_targets,
} from "../duck_db";
import { WebpageFetch } from "../page_capture_models";
import { read_metadata } from "./read_metadata";
import { FetchOutcome, FetchOutcomeKind } from "./fetch_outcome";
import { Fetcher, FetchResult } from "./headless_fetcher";

/** The content and metadata of one successfully re-downloaded public page. */
export interface CorpusContent {
  page_session_id: string;
  url: string;
  title: string;
  /** The re-downloaded public HTML. */
  content: string;
  site_name: string | null;
  author: string | null;
  published_at: string | null;
  lang: string | null;
  /** Fidelity: when it was fetched, the status, and the content hash. */
  fetched_at: string;
  http_status: number;
  content_hash: string;
}

/**
 * A read of one page's content. `ok` carries {@link CorpusContent}; every other
 * outcome is an exclusion carrying a reason and no content — "unavailable by
 * design". `null` (from {@link ContentCorpus.get_content}) means there is no
 * stored metadata row for that id at all.
 */
export type CorpusEntry =
  | { outcome: "ok"; content: CorpusContent }
  | {
      outcome: Exclude<FetchOutcomeKind, "ok">;
      page_session_id: string;
      url: string;
      reason: string;
    };

export interface ContentCorpus {
  /**
   * Reads the public content for a stored page session. Each call performs a LIVE,
   * side-effecting re-download — a politeness-gated headless navigation to the
   * remote host plus a `webpage_fetch` log write — there is no content cache in
   * this tier (an encrypted on-demand cache is task-39.3). Returns an exclusion
   * entry for auth/paywall/dead/non-HTML pages, or `null` if no metadata row
   * exists for the id.
   */
  get_content(page_session_id: string): Promise<CorpusEntry | null>;

  /**
   * Yields only the successfully re-downloadable public pages — the subset TDT and
   * RAG consume. Excluded and unfetchable pages are simply not emitted.
   */
  iter_public_pages(): AsyncIterable<CorpusContent>;
}

/** The reason string carried by a non-`ok` outcome. */
function reason_of(outcome: FetchOutcome): string {
  return outcome.kind === "ok" ? "" : outcome.reason;
}

export class ReDownloadCorpus implements ContentCorpus {
  constructor(
    private readonly db: DuckDB,
    private readonly fetcher: Fetcher
  ) {}

  async get_content(page_session_id: string): Promise<CorpusEntry | null> {
    const capture = await get_webpage_capture(this.db, page_session_id);
    if (!capture) return null;

    const result = await this.fetcher.fetch(capture.url);
    await this.record(page_session_id, capture.url, result);

    if (result.outcome.kind === "ok") {
      const metadata =
        result.metadata ?? read_metadata(result.outcome.html, capture.url);
      return {
        outcome: "ok",
        content: {
          page_session_id,
          url: capture.url,
          title: metadata.title,
          content: result.outcome.html,
          site_name: metadata.site_name,
          author: metadata.author,
          published_at: metadata.published_at,
          lang: metadata.lang,
          fetched_at: result.fidelity.fetched_at,
          http_status: result.outcome.http_status,
          // An ok outcome always carries a hash (sha-256 of the rendered HTML).
          content_hash: result.fidelity.content_hash,
        },
      };
    }

    return {
      outcome: result.outcome.kind,
      page_session_id,
      url: capture.url,
      reason: reason_of(result.outcome),
    };
  }

  async *iter_public_pages(): AsyncIterable<CorpusContent> {
    const targets = await list_capture_targets(this.db);
    for (const target of targets) {
      let entry: CorpusEntry | null = null;
      try {
        entry = await this.get_content(target.page_session_id);
      } catch (error) {
        // Isolate per-page infrastructure failures (e.g. a transient browser or
        // DB error) so one bad page does not abort the whole corpus pass.
        console.error(
          `re-download failed for ${target.page_session_id} (${target.url}):`,
          error
        );
        continue;
      }
      if (entry && entry.outcome === "ok") {
        yield entry.content;
      }
    }
  }

  /** Appends the fetch to the fidelity log so unavailability/drift stays visible. */
  private async record(
    page_session_id: string,
    url: string,
    result: FetchResult
  ): Promise<void> {
    const record: WebpageFetch = {
      page_session_id,
      url,
      final_url: result.fidelity.final_url,
      outcome: result.outcome.kind,
      http_status: result.fidelity.http_status,
      content_hash: result.fidelity.content_hash,
      content_type:
        result.outcome.kind === "non_html" ? result.outcome.content_type : null,
      author: result.metadata?.author ?? null,
      published_at: result.metadata?.published_at ?? null,
      lang: result.metadata?.lang ?? null,
      site_name: result.metadata?.site_name ?? null,
      fetched_at: result.fidelity.fetched_at,
    };
    await insert_webpage_fetch(this.db, record);
  }
}
