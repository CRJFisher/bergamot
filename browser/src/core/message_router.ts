import { TabHistoryStore, get_tab_history, get_referrer_from_history, update_tab_history, add_tab_history } from './tab_history_manager';
import { send_to_server } from './api_client';
import { create_api_client, ApiClientV2 } from './api_client_v2';
import { ReferrerInfo } from '../types/navigation';

export type MessageAction = 
  | 'getReferrer'
  | 'spaNavigation'
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
  
  const referrer_info = get_referrer_from_history(history, opener_history);
  
  console.log(`📍 Sending referrer response for tab ${tab_id}:`, {
    current_url: history?.current_url,
    previous_url: history?.previous_url,
    opener_tab_id: history?.opener_tab_id,
    computed_referrer: referrer_info.referrer,
    referrer_timestamp: referrer_info.referrer_timestamp,
  });

  return {
    success: true,
    referrer: referrer_info.referrer,
    referrer_timestamp: referrer_info.referrer_timestamp
  };
};

export const handle_spa_navigation = (
  tab_id: number,
  url: string,
  tab_history_store: TabHistoryStore
): { response: MessageResponse; new_store: TabHistoryStore } => {
  const current_history = get_tab_history(tab_history_store, tab_id);
  const updated_history = update_tab_history(current_history, url);
  const new_store = add_tab_history(tab_history_store, tab_id, updated_history);
  
  console.log(
    `📍 SPA Navigation in tab ${tab_id} to: ${url} (previous: ${
      current_history?.current_url || "none"
    })`
  );
  
  return {
    response: { success: true },
    new_store
  };
};

// Create API client with native messaging support
let api_client: ApiClientV2 | null = null;

const get_api_client = (api_base_url: string): ApiClientV2 => {
  if (!api_client) {
    api_client = create_api_client(api_base_url);
  }
  return api_client;
};

export const handle_server_request = async (
  endpoint: string,
  data: any,
  api_base_url: string
): Promise<MessageResponse> => {
  console.log(`🌐 Forwarding to PKM server:`, endpoint, data);
  
  try {
    // Try native messaging first
    const client = get_api_client(api_base_url);
    await client.send_to_server(endpoint, data);
    return { success: true };
  } catch (error: any) {
    console.warn('Native messaging failed, trying HTTP:', error);
    // Fallback to direct HTTP
    try {
      await send_to_server(api_base_url, endpoint, data);
      return { success: true };
    } catch (http_error: any) {
      return { success: false, error: http_error.message };
    }
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

    case 'spaNavigation':
      if (!sender_tab_id || !message.url) {
        return { response: { error: 'No tab ID or URL' } };
      }
      return handle_spa_navigation(sender_tab_id, message.url, tab_history_store);

    case 'sendToPKMServer':
      if (!message.endpoint || !message.data || !message.api_base_url) {
        return { response: { error: 'Missing endpoint, data, or API base URL' } };
      }
      const response = await handle_server_request(message.endpoint, message.data, message.api_base_url);
      return { response };

    default:
      return { response: { error: 'Unknown action' } };
  }
};