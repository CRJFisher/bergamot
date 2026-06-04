import {
  create_visit_data,
  create_zstd_instance
} from './core/data_collector';
import {
  load_configuration,
  get_api_base_url,
  is_debug_mode
} from './core/configuration_manager';

// Initialize configuration
const config = load_configuration();
console.log(
  `PKM: Using API base URL: ${get_api_base_url(config)} (debug: ${is_debug_mode(config)})`
);

// The zstd binding exposes a synchronous `compress` over raw bytes.
type ZstdCompressor = { compress: (data: Uint8Array) => Uint8Array };

// Compression instance — the only mutable state in the content script.
let zstd_instance: ZstdCompressor | null = null;

const SEND_RETRY_ATTEMPTS = 20;
const SEND_RETRY_DELAY_MS = 100;

// Sends a captured visit to the background for enrichment + forwarding. On a
// cold page load the background service worker may not be ready, so retry while
// the message channel is unavailable. A reached-but-failed response (real
// server error) is not retried.
const send_to_server = async (endpoint: string, data: Record<string, unknown>) => {
  for (let attempt = 0; attempt < SEND_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "sendToPKMServer",
        endpoint,
        data,
        api_base_url: get_api_base_url(config),
      });
      if (response?.success) {
        return;
      }
      // Background was reachable but reported a failure — do not spin on it.
      console.warn(
        `PKM: Failed to send to ${endpoint} (visit_id=${data.visit_id}):`,
        response?.error
      );
      return;
    } catch (error) {
      // Service worker not ready yet; wait and retry.
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_DELAY_MS));
  }
  console.warn(
    `PKM: Gave up sending to ${endpoint} (visit_id=${data.visit_id}) after retries`
  );
};

// Main page visit handler. The content script only captures page content; the
// background attaches the authoritative session metadata (referrer, group_id,
// opener_tab_id) when it forwards the visit, which avoids a racy round-trip to
// a possibly-cold service worker.
const handle_page_visit = async (url: string) => {
  const visit_data = await create_visit_data(url, "", undefined, zstd_instance);
  await send_to_server("/visit", visit_data);
};

// The background detects SPA navigations authoritatively via chrome.webNavigation
// (history.pushState runs in the page's main world and is invisible to the
// content script's isolated world), then asks us to capture the new document.
const listen_for_capture_requests = () => {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "captureVisit" && typeof message.url === "string") {
      handle_page_visit(message.url);
    }
  });
};

// Initialize the extension
const initialize_content_capture = async () => {
  // Initialize compression
  zstd_instance = await create_zstd_instance();

  // Capture the initial page load.
  console.log("Sending initial visit data");
  await handle_page_visit(window.location.href);

  // Capture subsequent same-document (SPA) navigations on the background's cue.
  listen_for_capture_requests();
};

// Wait for DOM to be ready, then initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize_content_capture);
} else {
  // The DOM is already ready
  initialize_content_capture();
}