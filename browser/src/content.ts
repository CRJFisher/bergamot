import { create_visit_data } from './core/data_collector';
import {
  load_configuration,
  get_api_base_url,
  is_debug_mode
} from './core/configuration_manager';
import { relay_dev_signal } from './core/dev_signal';

// Initialize configuration
const config = load_configuration();
const api_base_url = get_api_base_url(config);
console.log(
  `PKM: Using API base URL: ${api_base_url} (debug: ${is_debug_mode(config)})`
);

const SEND_RETRY_ATTEMPTS = 20;
const SEND_RETRY_DELAY_MS = 100;

// Sends a captured visit to the background for compression, enrichment, and
// forwarding. On a cold page load the background service worker may not be ready,
// so retry while the message channel is unavailable. A reached-but-failed
// response (real server error) is not retried. Returns whether the visit was
// accepted, so the caller can record a dev signal when it was not.
const send_to_server = async (
  endpoint: string,
  data: Record<string, unknown>
): Promise<boolean> => {
  for (let attempt = 0; attempt < SEND_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "sendToPKMServer",
        endpoint,
        data,
        api_base_url,
      });
      if (response?.success) {
        return true;
      }
      // Background was reachable but reported a failure — do not spin on it.
      console.warn(
        `PKM: Failed to send to ${endpoint} (visit_id=${data.visit_id}):`,
        response?.error
      );
      return false;
    } catch (error) {
      // Service worker not ready yet; wait and retry.
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_DELAY_MS));
  }
  console.warn(
    `PKM: Gave up sending to ${endpoint} (visit_id=${data.visit_id}) after retries`
  );
  return false;
};

// Main page visit handler. The content script captures raw page content; the
// background compresses it (page CSP can block WASM here) and attaches the
// authoritative session metadata (referrer, group_id, opener_tab_id) when it
// forwards the visit.
const handle_page_visit = async (url: string): Promise<void> => {
  const visit_data = create_visit_data(url, "", undefined);
  // "Page seen" beacon, emitted before the send: a visit that never reaches the
  // server (page CSP, cold worker, crash) still leaves a trace that can be
  // reconciled against the server's `http_received` to find silent drops.
  relay_dev_signal(
    'capture_attempted',
    { url, visit_id: visit_data.visit_id },
    api_base_url
  );
  const sent = await send_to_server("/visit", visit_data);
  if (!sent) {
    relay_dev_signal(
      'capture_failed',
      { url, visit_id: visit_data.visit_id, reason: 'send_failed' },
      api_base_url
    );
  }
};

// The background detects SPA navigations authoritatively via chrome.webNavigation
// (history.pushState runs in the page's main world and is invisible to the
// content script's isolated world), then asks us to capture the new document.
const listen_for_capture_requests = () => {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "captureVisit" && typeof message.url === "string") {
      handle_page_visit(message.url).catch((error) => {
        relay_dev_signal(
          'capture_failed',
          {
            url: message.url,
            error: error instanceof Error ? error.message : String(error),
            reason: 'spa_capture_threw',
          },
          api_base_url
        );
      });
    }
  });
};

// Initialize the extension. The SPA capture listener is registered FIRST so that
// a failure capturing the initial page can never prevent later same-document
// navigations from being captured.
const initialize_content_capture = async () => {
  listen_for_capture_requests();
  await handle_page_visit(window.location.href);
};

const start = () => {
  initialize_content_capture().catch((error) => {
    relay_dev_signal(
      'capture_failed',
      {
        url: window.location?.href,
        error: error instanceof Error ? error.message : String(error),
        reason: 'init_threw',
      },
      api_base_url
    );
  });
};

// Wait for DOM to be ready, then initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  // The DOM is already ready
  start();
}
