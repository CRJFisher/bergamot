/**
 * The re-downloadable public corpus: the content read path and the contract that
 * downstream consumers (Temporal Topic Detection — task-36; RAG — task-31) read.
 *
 * Given a stored metadata row, the corpus re-downloads its public URL through the
 * {@link Fetcher}, extracts clean main-content markdown + derived metadata from
 * the result via a single {@link parse_page} pass, records the fetch (outcome +
 * fidelity + metadata) to the `webpage_fetch` log, and exposes the result. Only
 * an `ok` re-download carries
 * content; authenticated, paywalled, dead, and non-HTML pages are reported as
 * unavailable, with no content. The login wall is the privacy filter — auth-walled
 * visits are trail/metadata only and are absent from this corpus.
 *
 * This live corpus persists nothing itself; it returns the parsed content on
 * demand. Persistence is the separate encrypted content cache (`content_cache.ts`),
 * written only through `CachedCorpus` — which the server wraps around this corpus
 * on the default read path, so served re-downloads are cached as a side effect.
 */
import {
  DuckDB,
  get_webpage_capture,
  insert_webpage_fetch,
  list_capture_targets,
} from "../duck_db";
import { getDomain } from "tldts";
import { WebpageFetch } from "../page_capture_models";
import { PageMetadata, parse_page } from "./main_content";
import { FetchOutcome, FetchOutcomeKind } from "./fetch_outcome";
import { Fetcher, FetchResult } from "./headless_fetcher";

/** The content and metadata of one successfully re-downloaded public page. */
export interface CorpusContent {
  page_session_id: string;
  url: string;
  title: string;
  /** Extracted main-content markdown (boilerplate pruned); raw HTML when extraction degrades. */
  content: string;
  site_name: string | null;
  author: string | null;
  published_at: string | null;
  lang: string | null;
  /** Fidelity: when it was fetched, the status, and the content hash. */
  fetched_at: string;
  http_status: number;
  /** sha-256 of the rendered HTML the body was extracted from; does not hash the stored body. */
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
   * Reads the public content for a stored page session. The live
   * {@link ReDownloadCorpus} performs a side-effecting re-download per call — a
   * politeness-gated headless navigation plus a `webpage_fetch` log write —
   * while {@link CachedCorpus} serves a cache hit without touching the network.
   * Returns an exclusion entry for auth/paywall/dead/non-HTML pages, or `null`
   * if no metadata row exists for the id.
   */
  get_content(page_session_id: string): Promise<CorpusEntry | null>;

  /**
   * Yields only the successfully re-downloadable public pages — the subset TDT and
   * RAG consume. Excluded and unfetchable pages are simply not emitted.
   *
   * @param exclude_origins registrable domains (TASK-36.8 never-cluster-origin)
   *   to drop from the pass BEFORE any read — so a blocked origin's page is never
   *   even re-downloaded, satisfying constitution §3's "feeds the
   *   skip-re-download list" (AC #8). Omit (or empty) to read the whole corpus.
   */
  iter_public_pages(
    exclude_origins?: ReadonlySet<string>,
  ): AsyncIterable<CorpusContent>;
}

/** The reason string carried by a non-`ok` outcome. */
function reason_of(outcome: FetchOutcome): string {
  return outcome.kind === "ok" ? "" : outcome.reason;
}

/**
 * One public-corpus pass: walks every stored fetch target through the given
 * content read and yields the `ok` pages. Shared by the live corpus and the
 * cached corpus so the pass policy (target list, per-page failure isolation,
 * never-cluster-origin exclusion) cannot drift between them.
 *
 * A target on an `exclude_origins` registrable domain is dropped BEFORE
 * `get_content` — which for the cached corpus would otherwise re-download and
 * cache it on a miss — so a blocked origin is never re-fetched (constitution §3).
 */
export async function* iter_public_pages_via(
  db: DuckDB,
  get_content: (page_session_id: string) => Promise<CorpusEntry | null>,
  exclude_origins: ReadonlySet<string> = new Set()
): AsyncIterable<CorpusContent> {
  const targets = await list_capture_targets(db);
  for (const target of targets) {
    if (exclude_origins.size > 0) {
      const domain = getDomain(target.url);
      if (domain !== null && exclude_origins.has(domain)) continue;
    }
    let entry: CorpusEntry | null = null;
    try {
      entry = await get_content(target.page_session_id);
    } catch (error) {
      // Isolate per-page infrastructure failures (e.g. a transient browser or
      // DB error) so one bad page does not abort the whole corpus pass. Only
      // the opaque session id is logged — the extension-host console persists
      // to plaintext log files, and URLs are sensitive metadata.
      console.error(
        `corpus read failed for page session ${target.page_session_id}:`,
        error
      );
      continue;
    }
    if (entry && entry.outcome === "ok") {
      yield entry.content;
    }
  }
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

    if (result.outcome.kind === "ok") {
      // One heuristic parse per ok re-download yields both the clean
      // main-content markdown and the page's derived metadata. Relative links
      // resolve against the post-redirect final URL the content was served from.
      const parsed = await parse_page(
        result.outcome.html,
        result.outcome.final_url
      );
      await this.record(page_session_id, capture.url, result, parsed.metadata);
      return {
        outcome: "ok",
        content: {
          page_session_id,
          url: capture.url,
          title: parsed.metadata.title,
          content: parsed.body_markdown,
          site_name: parsed.metadata.site_name,
          author: parsed.metadata.author,
          published_at: parsed.metadata.published_at,
          lang: parsed.metadata.lang,
          fetched_at: result.fidelity.fetched_at,
          http_status: result.outcome.http_status,
          // The hash stays the sha-256 of the rendered HTML the markdown was
          // extracted from — a fidelity marker of the fetch, not of the body.
          content_hash: result.fidelity.content_hash,
        },
      };
    }

    // Excluded outcomes carry no content to parse; the log records the exclusion.
    await this.record(page_session_id, capture.url, result, null);
    return {
      outcome: result.outcome.kind,
      page_session_id,
      url: capture.url,
      reason: reason_of(result.outcome),
    };
  }

  async *iter_public_pages(
    exclude_origins?: ReadonlySet<string>
  ): AsyncIterable<CorpusContent> {
    yield* iter_public_pages_via(
      this.db,
      (id) => this.get_content(id),
      exclude_origins
    );
  }

  /**
   * Appends the fetch to the fidelity log so unavailability/drift stays visible.
   * The derived metadata is the single parse from {@link get_content} (null for
   * excluded outcomes, which carry no content to parse).
   */
  private async record(
    page_session_id: string,
    url: string,
    result: FetchResult,
    metadata: PageMetadata | null
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
      author: metadata?.author ?? null,
      published_at: metadata?.published_at ?? null,
      lang: metadata?.lang ?? null,
      site_name: metadata?.site_name ?? null,
      fetched_at: result.fidelity.fetched_at,
    };
    await insert_webpage_fetch(this.db, record);
  }
}
