import { normalize_url_for_navigation } from "./url_cleaning";
import { Zstd } from "@hpcc-js/wasm-zstd";

// Allow configuration via global variable for testing
interface PKMConfig {
  apiBaseUrl?: string;
}

// Use build-time injected mock port if available (replaced by esbuild define)
declare const MOCK_PKM_PORT: string | undefined;

// In production, use port 5000 or a dynamic port lookup mechanism
const get_production_port = (): string => {
  // First check if we have a PKM_CONFIG with a custom port
  const config_port = (window as any).PKM_CONFIG?.apiBaseUrl;
  if (config_port) {
    return config_port;
  }

  // Default to port 5000 for production
  return "http://localhost:5000";
};

// Use mock port for testing, otherwise use production port
const DEFAULT_API_URL =
  typeof MOCK_PKM_PORT !== "undefined"
    ? `http://localhost:${MOCK_PKM_PORT}`
    : get_production_port();

const API_BASE_URL = DEFAULT_API_URL;

console.log(
  `PKM: Using API base URL: ${API_BASE_URL} (injected port: ${
    typeof MOCK_PKM_PORT !== "undefined" ? MOCK_PKM_PORT : "none"
  })`
);

interface VisitData extends Record<string, unknown> {
  url: string;
  page_loaded_at: string;
  referrer: string;
  referrer_timestamp?: number;
  content: string;
}

// Track visited URLs to avoid duplicate requests
const visited_urls = new Set<string>();

function has_been_visited(url: string): boolean {
  const normalized_url = normalize_url_for_navigation(url);
  return visited_urls.has(normalized_url);
}

function mark_as_visited(url: string): void {
  const normalized_url = normalize_url_for_navigation(url);
  console.log(`PKM: Marking URL as visited: ${normalized_url}`);
  visited_urls.add(normalized_url);
}

// Send data to background script which will forward to PKM server
async function send_to_server(endpoint: string, data: Record<string, unknown>) {
  try {
    console.log(`PKM: Sending data to ${endpoint}...`);
    const response = await chrome.runtime.sendMessage({
      action: "sendToPKMServer",
      endpoint: endpoint,
      data: data,
      apiBaseUrl: API_BASE_URL,
    });
    console.log(`PKM: Response from ${endpoint}:`, response);
    if (!response?.success) {
      console.warn(`PKM: Failed to send to ${endpoint}:`, response?.error);
    }
  } catch (error) {
    console.warn(`PKM: Error sending to ${endpoint}:`, error);
  }
}

// Get true referrer from background script
async function get_true_referrer(): Promise<{
  referrer: string;
  referrerTimestamp?: number;
}> {
  try {
    console.log("PKM: Requesting referrer from background script...");
    const response = await chrome.runtime.sendMessage({
      action: "getReferrer",
    });
    console.log("PKM: Received referrer response:", {
      referrer: response?.referrer,
      referrer_timestamp: response?.referrerTimestamp,
      current_url: window.location.href,
      document_referrer: document.referrer,
    });
    return response || { referrer: "" };
  } catch (error) {
    console.warn("PKM: Failed to get referrer from background script:", error);
    console.log("PKM: Falling back to document.referrer:", {
      document_referrer: document.referrer,
      current_url: window.location.href,
    });
    return { referrer: document.referrer || "" };
  }
}

// Robust base64 encoding that works with any binary data
function uint8_array_to_base64(uint8_array: Uint8Array): string {
  // Try the modern approach first (available in newer browsers)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(uint8_array).toString("base64");
  }

  // Fallback to manual conversion for older browsers
  let binary = "";
  const len = uint8_array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8_array[i]);
  }
  return btoa(binary);
}

async function get_content(): Promise<string> {
  try {
    // Get the entire body tag and its contents
    const body_html = document.body.outerHTML;

    const zstd = await Zstd.load();

    // Convert HTML string to Uint8Array
    const encoder = new TextEncoder();
    const html_bytes = encoder.encode(body_html);

    // Compress using zstandard
    const compressed_data = zstd.compress(html_bytes);

    console.log(
      `Body HTML compressed from ${html_bytes.length} to ${compressed_data.length} bytes`
    );

    // Convert compressed data to base64 for transport
    // Use a more robust base64 encoding that handles any binary data
    const base64_compressed = uint8_array_to_base64(compressed_data);

    return base64_compressed;
  } catch (e) {
    console.error("Content compression failed:", e);
    return "Error compressing page content.";
  }
}

// Send visit data when page loads
async function send_visit_data() {
  const current_url = window.location.href;

  // Mark this URL as visited to prevent duplicate SPA navigation events
  mark_as_visited(current_url);

  const { referrer, referrerTimestamp } = await get_true_referrer();

  const visitData: VisitData = {
    url: current_url,
    page_loaded_at: new Date().toISOString(),
    referrer: referrer,
    referrer_timestamp: referrerTimestamp,
    content: await get_content(),
  };

  console.log("PKM: Sending visit data:", {
    url: visitData.url,
    referrer: visitData.referrer,
    referrerTimestamp: visitData.referrer_timestamp,
  });

  send_to_server("/visit", visitData);
}

// Track SPA navigation events
function track_spa_navigation() {
  let current_path = normalize_url_for_navigation(window.location.href);
  console.log(
    `PKM: Initial SPA tracking setup - current_path: ${current_path}`
  );

  // Track history.pushState and history.replaceState
  const original_push_state = history.pushState;
  const original_replace_state = history.replaceState;

  history.pushState = function (state, title, url) {
    console.log(
      `PKM: pushState called with url: ${url}, current href: ${window.location.href}`
    );
    original_push_state.apply(this, [state, title, url]);
    const new_url = url?.toString() || window.location.href;
    const new_path = normalize_url_for_navigation(new_url);
    console.log(
      `PKM: pushState - current_path: ${current_path}, new_path: ${new_path}`
    );

    if (new_path !== current_path) {
      console.log(
        `PKM: pushState detected path change from ${current_path} to ${new_path}`
      );
      current_path = new_path;

      // Only handle SPA navigation if this URL hasn't been visited yet
      if (!has_been_visited(new_url)) {
        console.log(
          `PKM: pushState - URL ${new_url} not yet visited, handling SPA navigation`
        );
        handle_spa_navigation(new_url);
      } else {
        console.log(
          `PKM: pushState - URL ${new_url} already visited, skipping SPA navigation`
        );
      }
    } else {
      console.log(
        `PKM: pushState - no path change detected (${current_path} === ${new_path})`
      );
    }
  };

  history.replaceState = function (state, title, url) {
    console.log(
      `PKM: replaceState called with url: ${url}, current href: ${window.location.href}`
    );
    original_replace_state.apply(this, [state, title, url]);
    const new_url = url?.toString() || window.location.href;
    const new_path = normalize_url_for_navigation(new_url);
    console.log(
      `PKM: replaceState - current_path: ${current_path}, new_path: ${new_path}`
    );

    if (new_path !== current_path) {
      console.log(
        `PKM: replaceState detected path change from ${current_path} to ${new_path}`
      );
      current_path = new_path;

      // Only handle SPA navigation if this URL hasn't been visited yet
      if (!has_been_visited(new_url)) {
        console.log(
          `PKM: replaceState - URL ${new_url} not yet visited, handling SPA navigation`
        );
        handle_spa_navigation(new_url);
      } else {
        console.log(
          `PKM: replaceState - URL ${new_url} already visited, skipping SPA navigation`
        );
      }
    } else {
      console.log(
        `PKM: replaceState - no path change detected (${current_path} === ${new_path})`
      );
    }
  };

  // Track popstate events (back/forward navigation)
  window.addEventListener("popstate", () => {
    console.log(`PKM: popstate event - current href: ${window.location.href}`);
    const new_url = window.location.href;
    const new_path = normalize_url_for_navigation(new_url);
    console.log(
      `PKM: popstate - current_path: ${current_path}, new_path: ${new_path}`
    );

    if (new_path !== current_path) {
      console.log(
        `PKM: popstate detected path change from ${current_path} to ${new_path}`
      );
      current_path = new_path;

      // Only handle SPA navigation if this URL hasn't been visited yet
      if (!has_been_visited(new_url)) {
        console.log(
          `PKM: popstate - URL ${new_url} not yet visited, handling SPA navigation`
        );
        handle_spa_navigation(new_url);
      } else {
        console.log(
          `PKM: popstate - URL ${new_url} already visited, skipping SPA navigation`
        );
      }
    } else {
      console.log(
        `PKM: popstate - no path change detected (${current_path} === ${new_path})`
      );
    }
  });

  // Add additional URL change detection for SPAs that don't use standard navigation

  let last_known_url = window.location.href;
  // Also watch for DOM changes that might indicate navigation
  const observer = new MutationObserver(() => {
    const current_url = window.location.href;
    if (current_url !== last_known_url) {
      console.log(
        `PKM: URL change detected via MutationObserver - from ${last_known_url} to ${current_url}`
      );
      const new_path = normalize_url_for_navigation(current_url);
      console.log(
        `PKM: mutation - current_path: ${current_path}, new_path: ${new_path}`
      );

      if (new_path !== current_path) {
        console.log(
          `PKM: mutation detected path change from ${current_path} to ${new_path}`
        );
        current_path = new_path;

        // Only handle SPA navigation if this URL hasn't been visited yet
        if (!has_been_visited(current_url)) {
          console.log(
            `PKM: mutation - URL ${current_url} not yet visited, handling SPA navigation`
          );
          handle_spa_navigation(current_url);
        } else {
          console.log(
            `PKM: mutation - URL ${current_url} already visited, skipping SPA navigation`
          );
        }
      }
      last_known_url = current_url;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

async function handle_spa_navigation(new_url: string) {
  console.log(`PKM: SPA navigation detected to ${new_url}`);

  // Mark this URL as visited to prevent duplicate requests
  mark_as_visited(new_url);

  const { referrer, referrerTimestamp } = await get_true_referrer();

  const visitData: VisitData = {
    url: new_url,
    page_loaded_at: new Date().toISOString(),
    referrer: referrer,
    referrer_timestamp: referrerTimestamp,
    content: await get_content(),
  };

  console.log("PKM: Sending SPA navigation data:", {
    url: visitData.url,
    referrer: visitData.referrer,
    referrer_timestamp: visitData.referrer_timestamp,
  });

  // Notify background script about SPA navigation
  try {
    await chrome.runtime.sendMessage({
      action: "spaNavigation",
      url: new_url,
      page_loaded_at: new Date().toISOString(),
      referrer: referrer,
      referrer_timestamp: referrerTimestamp,
    });
  } catch (error) {
    console.warn(
      "PKM: Failed to notify background script about SPA navigation:",
      error
    );
  }

  send_to_server("/visit", visitData);
}

// Initialize the extension
async function initialize_pkm() {
  // Send initial visit data with true referrer
  console.log("Sending initial visit data");
  await send_visit_data();

  // Set up SPA navigation tracking
  track_spa_navigation();
}

// Wait for DOM to be ready, then initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize_pkm);
} else {
  // The DOM is already ready
  initialize_pkm();
}
