import { 
  NavigationState,
  create_navigation_state,
  create_push_state_handler,
  create_replace_state_handler,
  create_popstate_handler,
  create_mutation_observer
} from './core/navigation_detector';
import { 
  create_visit_data,
  create_zstd_instance
} from './core/data_collector';
import { 
  load_configuration,
  get_api_base_url,
  is_debug_mode
} from './core/configuration_manager';
import { ReferrerInfo } from './types/navigation';

// Initialize configuration
const config = load_configuration();
console.log(
  `PKM: Using API base URL: ${get_api_base_url(config)} (debug: ${is_debug_mode(config)})`
);

// Mutable state - the only non-functional parts
let navigation_state: NavigationState = create_navigation_state(window.location.href);
let zstd_instance: any = null;

// Communication functions
const get_true_referrer = async (): Promise<ReferrerInfo> => {
  try {
    console.log("PKM: Requesting referrer from background script...");
    const response = await chrome.runtime.sendMessage({
      action: "getReferrer",
    });
    console.log("PKM: Received referrer response:", {
      referrer: response?.referrer,
      referrer_timestamp: response?.referrer_timestamp,
      tab_id: response?.tab_id,
      group_id: response?.group_id,
      opener_tab_id: response?.opener_tab_id,
      current_url: window.location.href,
      document_referrer: document.referrer,
    });
    return new ReferrerInfo(
      response?.referrer || "",
      response?.referrer_timestamp,
      response?.tab_id,
      response?.group_id,
      response?.opener_tab_id
    );
  } catch (error) {
    console.warn("PKM: Failed to get referrer from background script:", error);
    console.log("PKM: Falling back to document.referrer:", {
      document_referrer: document.referrer,
      current_url: window.location.href,
    });
    return new ReferrerInfo(document.referrer || "");
  }
};

const send_to_server = async (endpoint: string, data: Record<string, unknown>) => {
  try {
    console.log(`PKM: Sending data to ${endpoint}...`);
    const response = await chrome.runtime.sendMessage({
      action: "sendToPKMServer",
      endpoint: endpoint,
      data: data,
      api_base_url: get_api_base_url(config),
    });
    console.log(`PKM: Response from ${endpoint}:`, response);
    if (!response?.success) {
      console.warn(`PKM: Failed to send to ${endpoint}:`, response?.error);
    }
  } catch (error) {
    console.warn(`PKM: Error sending to ${endpoint}:`, error);
  }
};

// Main page visit handler
const handle_page_visit = async (url: string) => {
  const referrer_info = await get_true_referrer();
  const visit_data = await create_visit_data(
    url,
    referrer_info.referrer,
    referrer_info.referrer_timestamp,
    zstd_instance,
    referrer_info.tab_id,
    referrer_info.group_id,
    referrer_info.opener_tab_id
  );

  console.log("PKM: Sending visit data:", {
    url: visit_data.url,
    referrer: visit_data.referrer,
    referrer_timestamp: visit_data.referrer_timestamp,
    tab_id: visit_data.tab_id,
    group_id: visit_data.group_id,
    opener_tab_id: visit_data.opener_tab_id,
  });

  // Notify background script about SPA navigation (except initial load)
  if (url !== window.location.href || navigation_state.visited_urls.size > 1) {
    try {
      await chrome.runtime.sendMessage({
        action: "spaNavigation",
        url: url,
        page_loaded_at: visit_data.page_loaded_at,
        referrer: referrer_info.referrer,
        referrer_timestamp: referrer_info.referrer_timestamp,
      });
    } catch (error) {
      console.warn("PKM: Failed to notify background script about SPA navigation:", error);
    }
  }

  send_to_server("/visit", visit_data);
};

// State update function
const update_navigation_state = (new_state: NavigationState) => {
  navigation_state = new_state;
};

// Initialize navigation tracking
const initialize_navigation_tracking = () => {
  // Override history methods
  history.pushState = create_push_state_handler(
    () => navigation_state,
    update_navigation_state,
    handle_page_visit
  );

  history.replaceState = create_replace_state_handler(
    () => navigation_state,
    update_navigation_state,
    handle_page_visit
  );

  // Set up event listeners
  window.addEventListener('popstate', create_popstate_handler(
    () => navigation_state,
    update_navigation_state,
    handle_page_visit
  ));

  // Set up mutation observer
  const observer = create_mutation_observer(
    () => navigation_state,
    update_navigation_state,
    handle_page_visit
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};

// Initialize the extension
const initialize_pkm = async () => {
  // Initialize compression
  zstd_instance = await create_zstd_instance();
  
  // Send initial visit data
  console.log("Sending initial visit data");
  await handle_page_visit(window.location.href);

  // Set up navigation tracking
  initialize_navigation_tracking();
};

// Wait for DOM to be ready, then initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize_pkm);
} else {
  // The DOM is already ready
  initialize_pkm();
}