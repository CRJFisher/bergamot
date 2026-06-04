import type { Message } from './message_router';
import { compress_content, ZstdCompressor } from './data_collector';
import type { BrowserDevStage } from './dev_signal';

/**
 * Builds a lazily-compiled, self-healing zstd accessor. The WASM module is
 * compiled once and the resulting promise is shared by concurrent callers, so a
 * burst of visits triggers a single compile. If the compile rejects (transient
 * WASM-instantiate failure, OOM during service-worker startup), the rejected
 * promise is NOT cached — the next call retries — so one failure cannot turn
 * every subsequent capture into an empty-content visit for the worker's life.
 */
export const make_lazy_zstd = (
  load: () => Promise<ZstdCompressor>
): (() => Promise<ZstdCompressor>) => {
  let cached: Promise<ZstdCompressor> | null = null;
  return () => {
    if (cached === null) {
      cached = load().catch((error) => {
        cached = null;
        throw error;
      });
    }
    return cached;
  };
};

/**
 * Compresses the page content of an outbound /visit payload. Compression runs in
 * the background service worker (the only context whose CSP permits WebAssembly),
 * never the content script. Non-visit messages and empty bodies pass through
 * untouched. On failure it reports a dev signal and forwards EMPTY content rather
 * than a corrupt body — the server would otherwise store the raw markup verbatim
 * and poison the page's embeddings.
 */
export const compress_visit_content = async (
  request: Message,
  get_zstd: () => Promise<ZstdCompressor>,
  report: (stage: BrowserDevStage, fields: Record<string, unknown>) => void
): Promise<Message> => {
  const content = request.data?.content;
  if (
    request.action !== 'sendToPKMServer' ||
    typeof content !== 'string' ||
    content.length === 0
  ) {
    return request;
  }
  try {
    const zstd = await get_zstd();
    const compressed = await compress_content(content, zstd);
    return { ...request, data: { ...request.data, content: compressed } };
  } catch (error) {
    report('compression_failed', {
      url: request.data?.url,
      visit_id: request.data?.visit_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...request, data: { ...request.data, content: '' } };
  }
};
