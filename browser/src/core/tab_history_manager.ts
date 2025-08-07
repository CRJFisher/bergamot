import { TabHistory, ReferrerInfo } from '../types/navigation';

// Pure functions for tab history management

// Generate a unique group ID for a navigation session
export const generate_group_id = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${timestamp}-${random}`;
};
export const create_tab_history = (
  url?: string,
  opener_tab_id?: number,
  previous_history?: TabHistory,
  opener_group_id?: string
): TabHistory => {
  // Inherit group_id from opener or generate new one for root tabs
  const group_id = opener_group_id || previous_history?.group_id || generate_group_id();
  
  return new TabHistory(
    previous_history?.current_url,
    url,
    Date.now(),
    previous_history?.timestamp,
    opener_tab_id || previous_history?.opener_tab_id,
    group_id
  );
};

export const update_tab_history = (
  current_history: TabHistory | undefined,
  new_url: string,
  opener_tab_id?: number
): TabHistory => {
  const should_update_previous = 
    !current_history?.previous_url || current_history.current_url !== new_url;

  return new TabHistory(
    should_update_previous ? current_history?.current_url : current_history?.previous_url,
    new_url,
    Date.now(),
    should_update_previous ? current_history?.timestamp : current_history?.previous_url_timestamp,
    current_history?.opener_tab_id || opener_tab_id,
    current_history?.group_id || generate_group_id() // Preserve or generate group_id
  );
};

export const get_referrer_from_history = (
  history: TabHistory | undefined,
  opener_history: TabHistory | undefined,
  tab_id?: number
): ReferrerInfo => {
  // Handle special case where previous_url is about:blank
  if (history?.opener_tab_id && 
      (!history.previous_url || history.previous_url === "about:blank" || history.previous_url === "") &&
      opener_history?.current_url) {
    return new ReferrerInfo(
      opener_history.current_url, 
      opener_history.timestamp,
      tab_id,
      history.group_id,
      history.opener_tab_id
    );
  }

  return new ReferrerInfo(
    history?.previous_url || "",
    history?.previous_url_timestamp || Date.now(),
    tab_id,
    history?.group_id,
    history?.opener_tab_id
  );
};

// Tab history store management (functional approach)
export type TabHistoryStore = Map<number, TabHistory>;

export const create_tab_history_store = (): TabHistoryStore => new Map();

export const add_tab_history = (
  store: TabHistoryStore,
  tab_id: number,
  history: TabHistory
): TabHistoryStore => {
  const new_store = new Map(store);
  new_store.set(tab_id, history);
  return new_store;
};

export const remove_tab_history = (
  store: TabHistoryStore,
  tab_id: number
): TabHistoryStore => {
  const new_store = new Map(store);
  new_store.delete(tab_id);
  return new_store;
};

export const get_tab_history = (
  store: TabHistoryStore,
  tab_id: number
): TabHistory | undefined => {
  return store.get(tab_id);
};