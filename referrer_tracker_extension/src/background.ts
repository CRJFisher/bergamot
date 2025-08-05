import { 
  TabHistoryStore, 
  create_tab_history_store, 
  create_tab_history,
  add_tab_history,
  remove_tab_history,
  get_tab_history,
  update_tab_history
} from './core/tab_history_manager';
import { handle_message } from './core/message_router';
import { TabHistory } from './types/navigation';

console.log("🚀 PKM Extension: Background script initialized");

// Mutable state - the only non-functional part
let tab_history_store: TabHistoryStore = create_tab_history_store();

// Tab event handlers
const handle_tab_created = async (tab: chrome.tabs.Tab) => {
  console.log(`🆕 Tab created:`, {
    tab_id: tab.id,
    opener_tab_id: tab.openerTabId,
    pending_url: tab.pendingUrl,
    url: tab.url,
  });

  if (tab.id) {
    const history = create_tab_history(
      tab.url || tab.pendingUrl,
      tab.openerTabId
    );
    tab_history_store = add_tab_history(tab_history_store, tab.id, history);
  }

  if (tab.id && tab.openerTabId) {
    await handle_tab_opener(tab.id, tab.openerTabId);
  }
};

const handle_tab_updated = async (
  tab_id: number,
  change_info: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) => {
  // Handle delayed opener info
  if (tab.openerTabId && !get_tab_history(tab_history_store, tab_id)?.opener_tab_id) {
    console.log(`📌 Tab ${tab_id} got opener info after creation:`, {
      opener_tab_id: tab.openerTabId,
      url: tab.url,
    });
    await handle_tab_opener(tab_id, tab.openerTabId);
  }

  // Handle URL changes
  if (change_info.status === "loading" && change_info.url) {
    const current_history = get_tab_history(tab_history_store, tab_id);
    const updated_history = update_tab_history(current_history, change_info.url, tab.openerTabId);
    tab_history_store = add_tab_history(tab_history_store, tab_id, updated_history);

    console.log(`📍 Tab ${tab_id} navigated to: ${change_info.url}`, {
      previous_url: current_history?.current_url,
      preserved_referrer: updated_history.previous_url,
      opener: tab.openerTabId || "none",
      updated_previous: current_history?.current_url !== change_info.url,
    });
  }
};

const handle_tab_removed = (tab_id: number) => {
  tab_history_store = remove_tab_history(tab_history_store, tab_id);
};

const handle_tab_opener = async (tab_id: number, opener_tab_id: number) => {
  console.log(`🔍 Handling tab opener relationship:`, {
    tab_id: tab_id,
    opener_tab_id: opener_tab_id,
  });

  let opener_history = get_tab_history(tab_history_store, opener_tab_id);
  const now = Date.now();

  // If we don't have the opener's URL, query it
  if (!opener_history?.current_url) {
    try {
      const opener_tab = await chrome.tabs.get(opener_tab_id);
      if (opener_tab.url) {
        const new_opener_history = new TabHistory(
          opener_history?.previous_url,
          opener_tab.url,
          now,
          opener_history?.previous_url_timestamp,
          opener_history?.opener_tab_id
        );
        tab_history_store = add_tab_history(tab_history_store, opener_tab_id, new_opener_history);
        opener_history = new_opener_history;
        
        console.log(`✅ Updated opener history for tab ${tab_id}:`, {
          opener_url: opener_tab.url,
          opener_tab_id: opener_tab_id,
        });
      }
    } catch (error) {
      console.warn(`Failed to get opener tab ${opener_tab_id}:`, error);
    }
  }

  if (opener_history?.current_url) {
    const current_history = get_tab_history(tab_history_store, tab_id);
    const new_history = new TabHistory(
      opener_history.current_url,
      current_history?.current_url,
      now,
      opener_history.timestamp,
      opener_tab_id
    );
    tab_history_store = add_tab_history(tab_history_store, tab_id, new_history);
    
    console.log(`✅ Set referrer for tab ${tab_id}:`, {
      referrer: opener_history.current_url,
      referrer_timestamp: opener_history.timestamp,
      opener_tab_id: opener_tab_id,
    });
  } else {
    console.log(`⚠️  Could not determine opener URL for tab ${tab_id}`);
  }
};

// Set up event listeners
chrome.tabs.onCreated.addListener(handle_tab_created);
chrome.tabs.onUpdated.addListener(handle_tab_updated);
chrome.tabs.onRemoved.addListener(handle_tab_removed);

// Message handling
chrome.runtime.onMessage.addListener((request, sender, send_response) => {
  console.log(
    `📨 Background received message:`,
    request.action,
    `from tab:`,
    sender.tab?.id
  );

  handle_message(request, sender.tab?.id, tab_history_store)
    .then(({ response, new_store }) => {
      if (new_store) {
        tab_history_store = new_store;
      }
      send_response(response);
    })
    .catch(error => {
      console.error(`Error handling message ${request.action}:`, error);
      send_response({ error: error.message });
    });

  return true; // Keep message channel open for async response
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("PKM Extension: Installed and ready to track browsing chains");
});

// Export for testing - using a function to get current state
export const get_tab_history_store = () => tab_history_store;

// Make it available globally for CDP testing
(globalThis as any).get_tab_history_store = get_tab_history_store;