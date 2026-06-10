/**
 * The scope-named cached read path over the re-download corpus — the single
 * population path into the encrypted content cache. The server wraps the default
 * read path (`/query/capture_content`) in a `CachedCorpus` under the `"default"`
 * scope at start, so ok re-downloads persist as they are served; a consumer that
 * needs repeated reads (a TDT run, a research project) wraps the live corpus
 * under its own scope. Only pages actually read enter the cache.
 */
import { DuckDB, get_webpage_capture } from "../duck_db";
import {
  ContentCorpus,
  CorpusContent,
  CorpusEntry,
  iter_public_pages_via,
} from "./corpus";
import type { ContentCache } from "./content_cache";

export class CachedCorpus implements ContentCorpus {
  /**
   * @param metadata_db - The metadata store (fetch targets + row existence)
   * @param corpus - The live re-download corpus to delegate misses to
   * @param cache - The encrypted content cache
   * @param scope - The named consumer cache entries are attributed to. A
   *   cache hit does not re-attribute an existing row's scope — the newest
   *   writer owns it (see `ContentCache.delete_scope`).
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
   *
   * The metadata row is checked first, even for a hit: `null` means "no
   * metadata row exists", and a page whose metadata has been forgotten must
   * not remain servable from the cache (the stale row is deleted on sight —
   * the cascade's backstop, not its replacement).
   */
  async get_content(page_session_id: string): Promise<CorpusEntry | null> {
    const capture = await get_webpage_capture(this.metadata_db, page_session_id);
    if (!capture) {
      const stale = await this.cache.get(page_session_id);
      if (stale) {
        await this.cache.delete_item(page_session_id);
      }
      return null;
    }
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
    yield* iter_public_pages_via(this.metadata_db, (id) =>
      this.get_content(id)
    );
  }
}
