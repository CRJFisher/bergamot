/**
 * The opt-in, scope-named cached read path over the re-download corpus. This
 * is the ONLY population path into the encrypted content cache: a consumer
 * that needs repeated content reads (a TDT run, a research project) wraps the
 * live corpus in a `CachedCorpus` with its scope name, and only the pages it
 * actually reads enter the cache. The default content read path
 * (`/query/capture_content`) stays uncached and re-downloads live — nothing
 * populates the cache ambiently.
 */
import { DuckDB, list_capture_targets } from "../duck_db";
import { ContentCorpus, CorpusContent, CorpusEntry } from "./corpus";
import { ContentCache } from "./content_cache";

export class CachedCorpus implements ContentCorpus {
  /**
   * @param metadata_db - The metadata store (the fetch-target list)
   * @param corpus - The live re-download corpus to delegate misses to
   * @param cache - The encrypted content cache
   * @param scope - The named consumer cache entries are attributed to
   */
  constructor(
    private readonly metadata_db: DuckDB,
    private readonly corpus: ContentCorpus,
    private readonly cache: ContentCache,
    private readonly scope: string
  ) {}

  /**
   * Reads one page's content: a cache hit is served without touching the
   * network; a miss delegates to the live corpus and caches an `ok` result
   * under this scope. Exclusions (auth/paywall/dead/non-HTML) are never
   * cached — they re-classify on every read, so a page that becomes public
   * later is not pinned to a stale exclusion.
   */
  async get_content(page_session_id: string): Promise<CorpusEntry | null> {
    const cached = await this.cache.get(page_session_id);
    if (cached) {
      return { outcome: "ok", content: cached };
    }
    const entry = await this.corpus.get_content(page_session_id);
    if (entry && entry.outcome === "ok") {
      await this.cache.put(entry.content, this.scope);
    }
    return entry;
  }

  /**
   * Yields the re-downloadable public subset through the cache: pages cached
   * by an earlier pass are served from the cache; the rest are fetched live
   * and cached. Excluded and unfetchable pages are not emitted.
   */
  async *iter_public_pages(): AsyncIterable<CorpusContent> {
    const targets = await list_capture_targets(this.metadata_db);
    for (const target of targets) {
      let entry: CorpusEntry | null = null;
      try {
        entry = await this.get_content(target.page_session_id);
      } catch (error) {
        // Mirror the live corpus: isolate per-page infrastructure failures so
        // one bad page does not abort the whole pass.
        console.error(
          `cached corpus read failed for ${target.page_session_id} (${target.url}):`,
          error
        );
        continue;
      }
      if (entry && entry.outcome === "ok") {
        yield entry.content;
      }
    }
  }
}
