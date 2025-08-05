import { normalize_url_for_navigation } from '../utils/url_cleaning';

export type NavigationCallback = (url: string) => void;

// State for navigation tracking
export interface NavigationState {
  current_path: string;
  visited_urls: Set<string>;
  last_known_url: string;
}

// Pure functions for navigation state management
export const create_navigation_state = (initial_url: string): NavigationState => ({
  current_path: normalize_url_for_navigation(initial_url),
  visited_urls: new Set([normalize_url_for_navigation(initial_url)]),
  last_known_url: initial_url
});

export const has_been_visited = (state: NavigationState, url: string): boolean => {
  const normalized_url = normalize_url_for_navigation(url);
  return state.visited_urls.has(normalized_url);
};

export const mark_as_visited = (state: NavigationState, url: string): NavigationState => {
  const normalized_url = normalize_url_for_navigation(url);
  console.log(`PKM: Marking URL as visited: ${normalized_url}`);
  
  const new_visited_urls = new Set(state.visited_urls);
  new_visited_urls.add(normalized_url);
  
  return {
    ...state,
    visited_urls: new_visited_urls
  };
};

export const should_handle_navigation = (
  state: NavigationState,
  new_url: string,
  source: string
): { should_handle: boolean; new_state: NavigationState } => {
  const new_path = normalize_url_for_navigation(new_url);
  
  console.log(`PKM: ${source} - current_path: ${state.current_path}, new_path: ${new_path}`);

  if (new_path !== state.current_path) {
    console.log(`PKM: ${source} detected path change from ${state.current_path} to ${new_path}`);
    
    const new_state: NavigationState = {
      ...state,
      current_path: new_path,
      last_known_url: new_url
    };

    if (!has_been_visited(state, new_url)) {
      console.log(`PKM: ${source} - URL ${new_url} not yet visited, handling navigation`);
      const marked_state = mark_as_visited(new_state, new_url);
      return { should_handle: true, new_state: marked_state };
    } else {
      console.log(`PKM: ${source} - URL ${new_url} already visited, skipping`);
      return { should_handle: false, new_state };
    }
  } else {
    console.log(`PKM: ${source} - no path change detected`);
    return { should_handle: false, new_state: state };
  }
};

// Factory functions for creating navigation handlers
export const create_push_state_handler = (
  get_state: () => NavigationState,
  update_state: (state: NavigationState) => void,
  callback: NavigationCallback
) => {
  const original_push_state = history.pushState;
  
  return function(state: any, title: string, url?: string | URL | null) {
    console.log(`PKM: pushState called with url: ${url}`);
    original_push_state.apply(history, [state, title, url]);
    
    const new_url = url?.toString() || window.location.href;
    const nav_state = get_state();
    const { should_handle, new_state } = should_handle_navigation(nav_state, new_url, 'pushState');
    
    update_state(new_state);
    if (should_handle) {
      callback(new_url);
    }
  };
};

export const create_replace_state_handler = (
  get_state: () => NavigationState,
  update_state: (state: NavigationState) => void,
  callback: NavigationCallback
) => {
  const original_replace_state = history.replaceState;
  
  return function(state: any, title: string, url?: string | URL | null) {
    console.log(`PKM: replaceState called with url: ${url}`);
    original_replace_state.apply(history, [state, title, url]);
    
    const new_url = url?.toString() || window.location.href;
    const nav_state = get_state();
    const { should_handle, new_state } = should_handle_navigation(nav_state, new_url, 'replaceState');
    
    update_state(new_state);
    if (should_handle) {
      callback(new_url);
    }
  };
};

export const create_popstate_handler = (
  get_state: () => NavigationState,
  update_state: (state: NavigationState) => void,
  callback: NavigationCallback
) => {
  return () => {
    console.log(`PKM: popstate event - current href: ${window.location.href}`);
    
    const nav_state = get_state();
    const { should_handle, new_state } = should_handle_navigation(nav_state, window.location.href, 'popstate');
    
    update_state(new_state);
    if (should_handle) {
      callback(window.location.href);
    }
  };
};

export const create_mutation_observer = (
  get_state: () => NavigationState,
  update_state: (state: NavigationState) => void,
  callback: NavigationCallback
): MutationObserver => {
  return new MutationObserver(() => {
    const current_url = window.location.href;
    const state = get_state();
    
    if (current_url !== state.last_known_url) {
      console.log(`PKM: URL change detected via MutationObserver - from ${state.last_known_url} to ${current_url}`);
      
      const { should_handle, new_state } = should_handle_navigation(state, current_url, 'mutation');
      update_state(new_state);
      
      if (should_handle) {
        callback(current_url);
      }
    }
  });
};