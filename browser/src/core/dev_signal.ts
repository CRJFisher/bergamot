/**
 * Browser-side dev observability.
 *
 * The content script has no structured log and cannot POST to the server under a
 * page's Content-Security-Policy, so it relays dev signals to the background
 * service worker via runtime messaging (which is NOT subject to the page's CSP).
 * The background forwards them to the server's `/dev_signal` endpoint, where they
 * land in the same `dev-log.jsonl` / "Bergamot Dev Log" sink as the server-side
 * pipeline stages.
 *
 * This closes the blind spot where a page is dropped before it ever reaches the
 * server (the server's first stage, `http_received`, never fires): a
 * `capture_attempted` with no matching `http_received` for the same `visit_id`
 * is precisely the set of silently-untracked pages.
 *
 * Writes are gated server-side (the dev-log `enabled` flag), so relaying is
 * always safe and strictly best-effort — a dev signal must never throw into or
 * block the capture path.
 */

export type BrowserDevStage =
  | 'capture_attempted'
  | 'capture_failed'
  | 'compression_failed';

export const relay_dev_signal = (
  stage: BrowserDevStage,
  fields: Record<string, unknown>,
  api_base_url: string
): void => {
  try {
    const sending = chrome.runtime.sendMessage({
      action: 'devSignal',
      stage,
      fields,
      api_base_url,
    });
    // MV3 `sendMessage` returns a promise; swallow rejection (no receiver / the
    // channel closing) so it never surfaces as an unhandled rejection.
    void sending?.catch?.(() => undefined);
  } catch {
    // `chrome.runtime` unavailable — nothing to do.
  }
};
