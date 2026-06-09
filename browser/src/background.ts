import {
  TabHistoryStore,
  create_tab_history,
  add_tab_history,
  remove_tab_history,
  get_tab_history,
  update_tab_history,
  generate_group_id,
} from './core/tab_history_manager';
import { load_store, save_store } from './core/tab_history_persistence';
import { handle_message, forward_dev_signal, Message, MessageResponse } from './core/message_router';
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
      // Persist before the next operation so a service-worker restart re-hydrates
      // the latest session graph (group_id inheritance must survive eviction).
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
          // The opener is a real tab and must have a session id; mint one if we
          // have not tracked it yet, so the child can inherit a defined group.
          opener_history?.group_id ?? generate_group_id()
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
      // Inherit the opener's group_id; never clobber the child's existing group
      // with an undefined value if the opener somehow lacks one.
      opener_history.group_id ?? current_history?.group_id
    );
    working = add_tab_history(working, tab_id, new_history);
  }

  return working;
};

// Ensures a tab has a history entry, minting a group_id (via create_tab_history,
// the single authority) only when the tab is genuinely new to us. Never
// overwrites an existing entry, so whichever event sees the tab first assigns
// the session id and later events preserve it.
const ensure_history = (
  store: TabHistoryStore,
  tab_id: number,
  url?: string
): TabHistoryStore =>
  get_tab_history(store, tab_id)
    ? store
    : add_tab_history(store, tab_id, create_tab_history(url));

// Records a navigation to `url` for a tab. For a brand-new tab it seeds the
// history (current_url = url, no previous_url); for an existing tab it shifts
// the prior url into previous_url. Calling ensure + update with the same url
// instead would set previous_url to the tab's own url (a self-referral).
const record_navigation = (
  store: TabHistoryStore,
  tab_id: number,
  url: string
): TabHistoryStore => {
  const existing = get_tab_history(store, tab_id);
  const next = existing
    ? update_tab_history(existing, url)
    : create_tab_history(url);
  return add_tab_history(store, tab_id, next);
};

// Tab event handlers — each returns the next store for `with_store` to persist.
const handle_tab_created = (tab: chrome.tabs.Tab) =>
  with_store(async (store) => {
    if (!tab.id) {
      return { store };
    }
    // Mint a group_id on first sighting; if this tab was opened by another,
    // inherit the opener's group + referrer instead.
    let working = ensure_history(store, tab.id, tab.url || tab.pendingUrl);
    if (tab.openerTabId) {
      working = await apply_tab_opener(working, tab.id, tab.openerTabId);
    }
    return { store: working };
  });

// Handles delayed opener info that can arrive after tab creation. URL changes
// are owned by the webNavigation listeners below (the authoritative source).
const handle_tab_updated = (tab_id: number, _change_info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) =>
  with_store(async (store) => {
    if (tab.openerTabId && !get_tab_history(store, tab_id)?.opener_tab_id) {
      return { store: await apply_tab_opener(store, tab_id, tab.openerTabId) };
    }
    return { store };
  });

const handle_tab_removed = (tab_id: number) =>
  with_store((store) => ({ store: remove_tab_history(store, tab_id) }));

// webNavigation is the authoritative source for navigation events: it sees both
// full-document and same-document (SPA) navigations regardless of which world
// triggered them, which the content script's isolated world cannot.

// A committed navigation (new document). Update the session graph; the content
// script captures the page content itself when it loads.
const handle_nav_committed = (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
  if (details.frameId !== 0) return;
  void with_store((store) => {
    return { store: record_navigation(store, details.tabId, details.url) };
  });
};

// A same-document (history.pushState/replaceState) navigation. Update the graph,
// then ask the content script to capture — it never reloads, so it would
// otherwise miss this visit entirely.
const handle_nav_history_state = (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
  if (details.frameId !== 0) return;
  void with_store((store) => {
    return { store: record_navigation(store, details.tabId, details.url) };
  }).then(() =>
    chrome.tabs
      .sendMessage(details.tabId, { action: "captureVisit", url: details.url })
      .catch(() => undefined)
  );
};

// A new tab/window opened from a link or window.open. This fires before the new
// tab's content script runs, so it is the reliable point to inherit the
// opener's group_id and set the referrer.
const handle_created_nav_target = (
  details: chrome.webNavigation.WebNavigationSourceCallbackDetails & { url: string }
) => {
  void with_store(async (store) => {
    const opener_group_id = get_tab_history(store, details.sourceTabId)?.group_id;
    let working = add_tab_history(
      store,
      details.tabId,
      create_tab_history(details.url, details.sourceTabId, undefined, opener_group_id)
    );
    working = await apply_tab_opener(working, details.tabId, details.sourceTabId);
    return { store: working };
  });
};

// Incognito tabs never reach this code: the extension is disabled in private
// browsing via manifest.json "incognito": "not_allowed", so no listener fires and
// no metadata is captured for an incognito tab (privacy-core principle 2).
// Set up event listeners (registered synchronously at top level, as MV3 requires).
chrome.tabs.onCreated.addListener(handle_tab_created);
chrome.tabs.onUpdated.addListener(handle_tab_updated);
chrome.tabs.onRemoved.addListener(handle_tab_removed);
chrome.webNavigation.onCommitted.addListener(handle_nav_committed);
chrome.webNavigation.onHistoryStateUpdated.addListener(handle_nav_history_state);
chrome.webNavigation.onCreatedNavigationTarget.addListener(handle_created_nav_target);

// Message handling — routed through the same serialized store chain.
const process_runtime_message = async (
  request: Message,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> => {
  // Browser-side dev signals carry no session state; relay them straight to the
  // server's dev-log sink without touching the store.
  if (request.action === 'devSignal') {
    await forward_dev_signal(
      request.stage ?? '',
      request.fields ?? {},
      request.api_base_url ?? ''
    );
    return { success: true };
  }

  const response = await with_store<MessageResponse>(async (store) => {
    // A page message can arrive before the tab/navigation events that would
    // create its history, so guarantee the tab has a group_id before we read or
    // attach session metadata.
    let base = store;
    const sender_tab = sender.tab;
    if (sender_tab?.id !== undefined) {
      base = ensure_history(base, sender_tab.id, sender_tab.url);
      // The sender tab object carries openerTabId directly, so we can inherit
      // the opener's group_id here even if onCreatedNavigationTarget/onCreated
      // have not been processed yet — removing the cross-event race.
      const history = get_tab_history(base, sender_tab.id);
      if (
        sender_tab.openerTabId !== undefined &&
        history?.opener_tab_id === undefined
      ) {
        base = await apply_tab_opener(base, sender_tab.id, sender_tab.openerTabId);
      }
    }
    const { response, new_store } = await handle_message(
      request,
      sender_tab?.id,
      base
    );
    return { store: new_store ?? base, result: response };
  });

  return response ?? { error: 'No response' };
};

chrome.runtime.onMessage.addListener((request, sender, send_response) => {
  process_runtime_message(request, sender)
    .then((response) => send_response(response))
    .catch((error) => {
      console.error(`Error handling message ${request?.action}:`, error);
      send_response({ error: error instanceof Error ? error.message : String(error) });
    });

  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Bergamot Extension: Installed and ready to track browsing chains");
});

// Export for testing — returns the current in-memory cache (may be null before
// the first hydration).
export const get_tab_history_store = () => tab_history_store;
