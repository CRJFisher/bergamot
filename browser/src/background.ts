import {
  TabHistoryStore,
  create_tab_history,
  add_tab_history,
  remove_tab_history,
  get_tab_history,
  update_tab_history,
} from './core/tab_history_manager';
import { load_store, save_store } from './core/tab_history_persistence';
import { handle_message } from './core/message_router';
import { TabHistory } from './types/navigation';

console.log("🚀 Bergamot Extension: Background script initialized");

// In-memory cache of the session graph. It is hydrated from
// chrome.storage.session on cold start and persisted after every mutation, so
// MV3 service-worker eviction does not fragment cross-page sessions.
let tab_history_store: TabHistoryStore | null = null;

// All store reads/writes are serialized through this chain so concurrent tab
// and message events cannot interleave a read-modify-write and lose updates.
let operation_chain: Promise<unknown> = Promise.resolve();

const ensure_hydrated = async (): Promise<TabHistoryStore> => {
  if (tab_history_store === null) {
    tab_history_store = await load_store();
  }
  return tab_history_store;
};

// Runs `mutator` against the current (hydrated) store, persists the result, and
// returns whatever the mutator returns. Operations are queued, never overlapped.
const with_store = <T>(
  mutator: (
    store: TabHistoryStore
  ) => Promise<{ store: TabHistoryStore; result?: T }> | { store: TabHistoryStore; result?: T }
): Promise<T | undefined> => {
  const next = operation_chain.then(async () => {
    const store = await ensure_hydrated();
    const { store: new_store, result } = await mutator(store);
    if (new_store !== store) {
      tab_history_store = new_store;
      await save_store(new_store);
    }
    return result;
  });
  operation_chain = next.catch(() => undefined);
  return next;
};

// Resolves the opener relationship for a tab: looks up (and if needed queries)
// the opener's URL, then sets this tab's referrer and inherits its group_id.
const apply_tab_opener = async (
  store: TabHistoryStore,
  tab_id: number,
  opener_tab_id: number
): Promise<TabHistoryStore> => {
  let working = store;
  let opener_history = get_tab_history(working, opener_tab_id);
  const now = Date.now();

  if (!opener_history?.current_url) {
    try {
      const opener_tab = await chrome.tabs.get(opener_tab_id);
      if (opener_tab.url) {
        const new_opener_history = new TabHistory(
          opener_history?.previous_url,
          opener_tab.url,
          now,
          opener_history?.previous_url_timestamp,
          opener_history?.opener_tab_id,
          opener_history?.group_id
        );
        working = add_tab_history(working, opener_tab_id, new_opener_history);
        opener_history = new_opener_history;
      }
    } catch (error) {
      console.warn(`Failed to get opener tab ${opener_tab_id}:`, error);
    }
  }

  if (opener_history?.current_url) {
    const current_history = get_tab_history(working, tab_id);
    const new_history = new TabHistory(
      opener_history.current_url,
      current_history?.current_url,
      now,
      opener_history.timestamp,
      opener_tab_id,
      opener_history.group_id // inherit group_id from opener (single authority)
    );
    working = add_tab_history(working, tab_id, new_history);
  }

  return working;
};

// Tab event handlers — each returns the next store for `with_store` to persist.
const handle_tab_created = (tab: chrome.tabs.Tab) =>
  with_store(async (store) => {
    if (!tab.id) {
      return { store };
    }

    const opener_group_id = tab.openerTabId
      ? get_tab_history(store, tab.openerTabId)?.group_id
      : undefined;

    const history = create_tab_history(
      tab.url || tab.pendingUrl,
      tab.openerTabId,
      undefined,
      opener_group_id
    );
    let working = add_tab_history(store, tab.id, history);

    if (tab.openerTabId) {
      working = await apply_tab_opener(working, tab.id, tab.openerTabId);
    }

    return { store: working };
  });

const handle_tab_updated = (
  tab_id: number,
  change_info: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) =>
  with_store(async (store) => {
    let working = store;

    // Handle delayed opener info that arrives after tab creation.
    if (tab.openerTabId && !get_tab_history(working, tab_id)?.opener_tab_id) {
      working = await apply_tab_opener(working, tab_id, tab.openerTabId);
    }

    // Handle committed URL changes.
    if (change_info.status === "loading" && change_info.url) {
      const current_history = get_tab_history(working, tab_id);
      const updated_history = update_tab_history(
        current_history,
        change_info.url,
        tab.openerTabId
      );
      working = add_tab_history(working, tab_id, updated_history);
    }

    return { store: working };
  });

const handle_tab_removed = (tab_id: number) =>
  with_store((store) => ({ store: remove_tab_history(store, tab_id) }));

// Set up event listeners (registered synchronously at top level, as MV3 requires).
chrome.tabs.onCreated.addListener(handle_tab_created);
chrome.tabs.onUpdated.addListener(handle_tab_updated);
chrome.tabs.onRemoved.addListener(handle_tab_removed);

// Message handling — routed through the same serialized store chain.
chrome.runtime.onMessage.addListener((request, sender, send_response) => {
  with_store(async (store) => {
    const { response, new_store } = await handle_message(
      request,
      sender.tab?.id,
      store
    );
    return { store: new_store ?? store, result: response };
  })
    .then((response) => send_response(response))
    .catch((error) => {
      console.error(`Error handling message ${request.action}:`, error);
      send_response({ error: error.message });
    });

  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Bergamot Extension: Installed and ready to track browsing chains");
});

// Export for testing — returns the current in-memory cache (may be null before
// the first hydration).
export const get_tab_history_store = () => tab_history_store;
