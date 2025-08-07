/**
 * Helper utilities for navigation testing
 */

import CDP from 'chrome-remote-interface';

export interface NavigationEvent {
  url: string;
  referrer?: string;
  timestamp: number;
  navigation_type: 'navigate' | 'reload' | 'back_forward' | 'prerender';
  tab_id?: number;
  opener_tab_id?: number;
  is_spa?: boolean;
  is_new_tab?: boolean;
}

export interface NavigationChain {
  chain_id: string;
  events: NavigationEvent[];
  start_time: number;
  end_time?: number;
}

export class NavigationVerifier {
  private navigation_chains: Map<string, NavigationChain> = new Map();
  private current_chain_id: string | null = null;

  /**
   * Start tracking a new navigation chain
   */
  start_chain(chain_id?: string): string {
    const id = chain_id || `chain_${Date.now()}`;
    this.current_chain_id = id;
    
    this.navigation_chains.set(id, {
      chain_id: id,
      events: [],
      start_time: Date.now()
    });
    
    return id;
  }

  /**
   * Add a navigation event to the current chain
   */
  add_navigation(event: NavigationEvent): void {
    if (!this.current_chain_id) {
      this.start_chain();
    }
    
    const chain = this.navigation_chains.get(this.current_chain_id!);
    if (chain) {
      chain.events.push(event);
    }
  }

  /**
   * End the current navigation chain
   */
  end_chain(): NavigationChain | null {
    if (!this.current_chain_id) return null;
    
    const chain = this.navigation_chains.get(this.current_chain_id);
    if (chain) {
      chain.end_time = Date.now();
    }
    
    this.current_chain_id = null;
    return chain || null;
  }

  /**
   * Get a specific navigation chain
   */
  get_chain(chain_id: string): NavigationChain | undefined {
    return this.navigation_chains.get(chain_id);
  }

  /**
   * Verify if a navigation chain has the expected properties
   */
  verify_chain(chain_id: string, expectations: {
    min_events?: number;
    has_referrer?: boolean;
    has_spa_navigation?: boolean;
    has_new_tab?: boolean;
    has_opener?: boolean;
  }): boolean {
    const chain = this.navigation_chains.get(chain_id);
    if (!chain) return false;

    if (expectations.min_events && chain.events.length < expectations.min_events) {
      return false;
    }

    if (expectations.has_referrer) {
      const has_ref = chain.events.some(e => e.referrer);
      if (!has_ref) return false;
    }

    if (expectations.has_spa_navigation) {
      const has_spa = chain.events.some(e => e.is_spa);
      if (!has_spa) return false;
    }

    if (expectations.has_new_tab) {
      const has_tab = chain.events.some(e => e.is_new_tab);
      if (!has_tab) return false;
    }

    if (expectations.has_opener) {
      const has_opener = chain.events.some(e => e.opener_tab_id !== undefined);
      if (!has_opener) return false;
    }

    return true;
  }

  /**
   * Get statistics for a navigation chain
   */
  get_chain_stats(chain_id: string): {
    total_events: number;
    duration_ms: number;
    unique_urls: number;
    spa_navigations: number;
    new_tabs: number;
  } | null {
    const chain = this.navigation_chains.get(chain_id);
    if (!chain) return null;

    const unique_urls = new Set(chain.events.map(e => e.url));
    const spa_navs = chain.events.filter(e => e.is_spa).length;
    const new_tabs = chain.events.filter(e => e.is_new_tab).length;
    const duration = (chain.end_time || Date.now()) - chain.start_time;

    return {
      total_events: chain.events.length,
      duration_ms: duration,
      unique_urls: unique_urls.size,
      spa_navigations: spa_navs,
      new_tabs: new_tabs
    };
  }

  /**
   * Clear all navigation chains
   */
  clear(): void {
    this.navigation_chains.clear();
    this.current_chain_id = null;
  }
}

/**
 * Extract navigation data from console logs
 */
export function parse_navigation_from_logs(logs: Array<{message: string, timestamp: string}>): NavigationEvent[] {
  const events: NavigationEvent[] = [];

  for (const log of logs) {
    // Look for navigation-related log patterns
    if (log.message.includes('navigation') || 
        log.message.includes('visit') || 
        log.message.includes('page_load')) {
      
      // Try to extract URL
      const url_match = log.message.match(/url[:\s]+([^\s,]+)/i);
      const url = url_match ? url_match[1] : '';

      // Try to extract referrer
      const ref_match = log.message.match(/referrer[:\s]+([^\s,]+)/i);
      const referrer = ref_match ? ref_match[1] : undefined;

      // Try to extract navigation type
      let nav_type: NavigationEvent['navigation_type'] = 'navigate';
      if (log.message.includes('reload')) nav_type = 'reload';
      if (log.message.includes('back') || log.message.includes('forward')) nav_type = 'back_forward';

      // Check for SPA navigation
      const is_spa = log.message.includes('pushState') || 
                     log.message.includes('replaceState') ||
                     log.message.includes('spa');

      // Check for new tab
      const is_new_tab = log.message.includes('new_tab') || 
                         log.message.includes('target="_blank"');

      if (url) {
        events.push({
          url,
          referrer,
          timestamp: new Date(log.timestamp).getTime(),
          navigation_type: nav_type,
          is_spa,
          is_new_tab
        });
      }
    }
  }

  return events;
}

/**
 * Wait for a specific navigation pattern in CDP
 */
export async function wait_for_navigation_pattern(
  client: CDP.Client,
  pattern: RegExp | string,
  timeout: number = 5000
): Promise<boolean> {
  const start_time = Date.now();
  
  return new Promise((resolve) => {
    const check_pattern = async () => {
      try {
        const result = await client.Runtime.evaluate({
          expression: 'window.location.href'
        });
        
        const current_url = result.result.value as string;
        const matches = typeof pattern === 'string' 
          ? current_url.includes(pattern)
          : pattern.test(current_url);
        
        if (matches) {
          resolve(true);
          return;
        }
      } catch (e) {
        // Ignore errors and continue checking
      }
      
      if (Date.now() - start_time < timeout) {
        setTimeout(check_pattern, 100);
      } else {
        resolve(false);
      }
    };
    
    check_pattern();
  });
}

/**
 * Get all open tabs via CDP
 */
export async function get_all_tabs(port: number = 9222): Promise<Array<{
  id: string;
  url: string;
  title: string;
  type: string;
}>> {
  const targets = await CDP.List({ port });
  
  return targets
    .filter(t => t.type === 'page')
    .map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      type: t.type
    }));
}

/**
 * Simulate various navigation actions
 */
export class NavigationSimulator {
  constructor(private client: CDP.Client) {}

  /**
   * Simulate a normal link click
   */
  async click_link(selector: string): Promise<void> {
    await this.client.Runtime.evaluate({
      expression: `document.querySelector('${selector}').click()`
    });
  }

  /**
   * Simulate opening link in new tab (Ctrl+Click)
   */
  async open_in_new_tab(selector: string): Promise<void> {
    await this.client.Runtime.evaluate({
      expression: `
        const link = document.querySelector('${selector}');
        if (link) {
          const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            ctrlKey: true,
            button: 0
          });
          link.dispatchEvent(event);
        }
      `
    });
  }

  /**
   * Simulate middle mouse click (opens in new tab)
   */
  async middle_click(selector: string): Promise<void> {
    await this.client.Runtime.evaluate({
      expression: `
        const link = document.querySelector('${selector}');
        if (link) {
          const event = new MouseEvent('auxclick', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 1  // Middle button
          });
          link.dispatchEvent(event);
        }
      `
    });
  }

  /**
   * Simulate browser back button
   */
  async go_back(): Promise<void> {
    await this.client.Page.goBack();
  }

  /**
   * Simulate browser forward button
   */
  async go_forward(): Promise<void> {
    await this.client.Page.goForward();
  }

  /**
   * Simulate page reload
   */
  async reload(): Promise<void> {
    await this.client.Page.reload();
  }

  /**
   * Simulate form submission
   */
  async submit_form(form_selector: string, field_values?: Record<string, string>): Promise<void> {
    if (field_values) {
      for (const [field, value] of Object.entries(field_values)) {
        await this.client.Runtime.evaluate({
          expression: `document.querySelector('${field}').value = '${value}'`
        });
      }
    }

    await this.client.Runtime.evaluate({
      expression: `document.querySelector('${form_selector}').submit()`
    });
  }

  /**
   * Simulate JavaScript navigation
   */
  async navigate_with_js(url: string): Promise<void> {
    await this.client.Runtime.evaluate({
      expression: `window.location.href = '${url}'`
    });
  }

  /**
   * Simulate History API navigation (for SPAs)
   */
  async push_state(path: string, title?: string): Promise<void> {
    await this.client.Runtime.evaluate({
      expression: `history.pushState({}, '${title || ''}', '${path}')`
    });
  }

  /**
   * Simulate hash navigation
   */
  async navigate_hash(hash: string): Promise<void> {
    await this.client.Runtime.evaluate({
      expression: `window.location.hash = '${hash}'`
    });
  }
}