// Persists the tab/session graph in chrome.storage.session so that Manifest V3
// service-worker eviction (Chrome suspends idle workers after ~30s) does not
// wipe opener relationships and group_id inheritance mid-session.
//
// `session` storage is in-memory and cleared when the browser closes — exactly
// the right lifetime for a graph keyed by ephemeral tab ids.

import {
  TabHistoryStore,
  serialize_store,
  deserialize_store,
} from "./tab_history_manager";

const STORAGE_KEY = "tab_history_store";

export const load_store = async (): Promise<TabHistoryStore> => {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return deserialize_store(result?.[STORAGE_KEY]);
};

export const save_store = async (store: TabHistoryStore): Promise<void> => {
  await chrome.storage.session.set({ [STORAGE_KEY]: serialize_store(store) });
};
