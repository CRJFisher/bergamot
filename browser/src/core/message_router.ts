import { TabHistoryStore, get_tab_history, get_referrer_from_history } from './tab_history_manager';
import { send_to_server } from './api_client';
import { discover_server_url } from './server_discovery';

export type MessageAction =
  | 'getReferrer'
  | 'sendToPKMServer';

export interface Message {
  action: MessageAction;
  url?: string;
  endpoint?: string;
  data?: any;
  api_base_url?: string;
  page_loaded_at?: string;
  referrer?: string;
  referrer_timestamp?: number;
}

export interface MessageResponse {
  success?: boolean;
  error?: string;
  referrer?: string;
  referrer_timestamp?: number;
  // Group connection fields
  tab_id?: number;
  group_id?: string;
  opener_tab_id?: number;
}

// Pure message handlers
export const handle_get_referrer = (
  tab_id: number,
  tab_history_store: TabHistoryStore
): MessageResponse => {
  const history = get_tab_history(tab_history_store, tab_id);
  const opener_history = history?.opener_tab_id 
    ? get_tab_history(tab_history_store, history.opener_tab_id)
    : undefined;
  
  const referrer_info = get_referrer_from_history(history, opener_history, tab_id);
  
  console.log(`📍 Sending referrer response for tab ${tab_id}:`, {
    current_url: history?.current_url,
    previous_url: history?.previous_url,
    opener_tab_id: history?.opener_tab_id || 'NONE',
    group_id: history?.group_id || 'NONE',
    computed_referrer: referrer_info.referrer,
    referrer_timestamp: referrer_info.referrer_timestamp,
    response_tab_id: referrer_info.tab_id,
    response_group_id: referrer_info.group_id || 'NONE',
    response_opener_tab_id: referrer_info.opener_tab_id || 'NONE',
  });

  return {
    success: true,
    referrer: referrer_info.referrer,
    referrer_timestamp: referrer_info.referrer_timestamp,
    tab_id: referrer_info.tab_id,
    group_id: referrer_info.group_id,
    opener_tab_id: referrer_info.opener_tab_id
  };
};

// Attaches authoritative session metadata (referrer, group_id, opener) from the
// background's store to a captured visit. The content script no longer fetches
// these — it would race a cold service worker — so the background, which owns
// the session graph, fills them in at forward time.
const enrich_visit_with_session = (
  data: any,
  tab_id: number,
  tab_history_store: TabHistoryStore
): any => {
  const history = get_tab_history(tab_history_store, tab_id);
  const opener_history = history?.opener_tab_id
    ? get_tab_history(tab_history_store, history.opener_tab_id)
    : undefined;
  const referrer_info = get_referrer_from_history(history, opener_history, tab_id);
  return {
    ...data,
    referrer: referrer_info.referrer,
    referrer_timestamp: referrer_info.referrer_timestamp,
    tab_id: referrer_info.tab_id,
    group_id: referrer_info.group_id,
    opener_tab_id: referrer_info.opener_tab_id,
  };
};

// Cache of the last server URL that successfully accepted a visit. A browser
// extension cannot read the server's port file, so it probes the candidate
// range over HTTP and remembers the winner. The cache is module state in the
// background service worker; it is simply re-discovered after SW eviction.
let cached_server_url: string | null = null;

export const handle_server_request = async (
  endpoint: string,
  data: any,
  api_base_url: string
): Promise<MessageResponse> => {
  console.log(`🌐 Forwarding to Bergamot server:`, endpoint, data);

  const target = cached_server_url ?? api_base_url;
  try {
    await send_to_server(target, endpoint, data);
    cached_server_url = target;
    return { success: true };
  } catch (error: any) {
    // The cached/default port may be stale, or the server bound a different
    // port in the candidate range. Re-discover once and retry.
    const discovered = await discover_server_url();
    if (discovered && discovered !== target) {
      try {
        await send_to_server(discovered, endpoint, data);
        cached_server_url = discovered;
        return { success: true };
      } catch (retry_error: any) {
        cached_server_url = null;
        return { success: false, error: retry_error.message };
      }
    }
    cached_server_url = null;
    return { success: false, error: error.message };
  }
};

// Message dispatcher
export const handle_message = async (
  message: Message,
  sender_tab_id: number | undefined,
  tab_history_store: TabHistoryStore
): Promise<{ response: MessageResponse; new_store?: TabHistoryStore }> => {
  switch (message.action) {
    case 'getReferrer':
      if (!sender_tab_id) {
        return { response: { error: 'No tab ID' } };
      }
      return { response: handle_get_referrer(sender_tab_id, tab_history_store) };

    case 'sendToPKMServer': {
      if (!message.endpoint || !message.data || !message.api_base_url) {
        return { response: { error: 'Missing endpoint, data, or API base URL' } };
      }
      const enriched = sender_tab_id !== undefined
        ? enrich_visit_with_session(message.data, sender_tab_id, tab_history_store)
        : message.data;
      const response = await handle_server_request(message.endpoint, enriched, message.api_base_url);
      return { response };
    }

    default:
      return { response: { error: 'Unknown action' } };
  }
};