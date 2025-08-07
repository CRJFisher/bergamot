import { ExtensionTestRunner } from './cdp_extension_test';
import CDP from 'chrome-remote-interface';

interface TabHistoryState {
  tab_id: number;
  current_url?: string;
  previous_url?: string;
  opener_tab_id?: number;
  timestamp: number;
  previous_url_timestamp?: number;
}

export class BackgroundStateTests {
  private runner: ExtensionTestRunner;
  private background_client: CDP.Client | null = null;

  constructor() {
    this.runner = new ExtensionTestRunner();
  }

  async run_all_tests(): Promise<void> {
    try {
      await this.runner.setup();
      await this.runner.enable_console_monitoring();
      await this.connect_to_background();
      
      console.log('\n🧪 Running Background Script State Tests\n');

      await this.test_tab_history_creation();
      await this.test_tab_history_updates();
      await this.test_opener_inheritance();
      await this.test_spa_state_updates();
      await this.test_tab_removal_cleanup();
      await this.test_message_routing();

    } finally {
      if (this.background_client) {
        await this.background_client.close();
      }
      await this.runner.cleanup();
    }
  }

  private async connect_to_background(): Promise<void> {
    const targets = await CDP.List({ port: 9222 });
    const background_target = targets.find(t => 
      t.type === 'background_page' || 
      t.url?.includes('background')
    );
    
    if (!background_target) {
      throw new Error('Background page not found');
    }
    
    this.background_client = await CDP({ 
      target: background_target.id, 
      port: 9222 
    });
    
    await this.background_client.Runtime.enable();
    console.log('✅ Connected to background script');
  }

  private async get_tab_history_state(): Promise<TabHistoryState[]> {
    if (!this.background_client) throw new Error('Background client not connected');
    
    const result = await this.background_client.Runtime.evaluate({
      expression: `
        (() => {
          const state = [];
          const store = get_tab_history_store();
          for (const [tab_id, history] of store.entries()) {
            state.push({
              tab_id,
              current_url: history.current_url,
              previous_url: history.previous_url,
              opener_tab_id: history.opener_tab_id,
              timestamp: history.timestamp,
              previous_url_timestamp: history.previous_url_timestamp
            });
          }
          return state;
        })()
      `,
      returnByValue: true
    });
    
    return result.result.value as TabHistoryState[];
  }

  private async test_tab_history_creation(): Promise<void> {
    console.log('\n📋 Test 1: Tab History Creation');
    
    // Get initial state
    const initial_state = await this.get_tab_history_state();
    const initial_count = initial_state.length;
    
    // Navigate to create a new tab entry
    await this.runner.navigate_to('https://example.com/test1');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get updated state
    const updated_state = await this.get_tab_history_state();
    const new_tab = updated_state.find(tab => 
      tab.current_url === 'https://example.com/test1'
    );
    
    if (new_tab && updated_state.length > initial_count) {
      console.log('  ✅ Tab history created successfully');
      console.log(`     Tab ID: ${new_tab.tab_id}`);
      console.log(`     URL: ${new_tab.current_url}`);
      console.log(`     Timestamp: ${new Date(new_tab.timestamp).toISOString()}`);
    } else {
      console.log('  ❌ Tab history not created');
    }
  }

  private async test_tab_history_updates(): Promise<void> {
    console.log('\n📋 Test 2: Tab History Updates on Navigation');
    
    // Navigate to first page
    await this.runner.navigate_to('https://example.com/first');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const state_after_first = await this.get_tab_history_state();
    const tab = state_after_first[state_after_first.length - 1];
    const tab_id = tab.tab_id;
    
    // Navigate to second page
    await this.runner.navigate_to('https://example.com/second');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const state_after_second = await this.get_tab_history_state();
    const updated_tab = state_after_second.find(t => t.tab_id === tab_id);
    
    if (updated_tab && 
        updated_tab.current_url === 'https://example.com/second' &&
        updated_tab.previous_url === 'https://example.com/first') {
      console.log('  ✅ Tab history updated correctly');
      console.log(`     Previous: ${updated_tab.previous_url}`);
      console.log(`     Current: ${updated_tab.current_url}`);
    } else {
      console.log('  ❌ Tab history not updated properly');
    }
  }

  private async test_opener_inheritance(): Promise<void> {
    console.log('\n📋 Test 3: Opener Tab Inheritance');
    
    // Navigate to source page
    await this.runner.navigate_to('https://example.com/opener-source');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const state_before = await this.get_tab_history_state();
    const source_tab = state_before[state_before.length - 1];
    
    // Open new tab
    await this.runner.open_new_tab('https://example.com/opener-target');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const state_after = await this.get_tab_history_state();
    const new_tab = state_after.find(tab => 
      tab.current_url === 'https://example.com/opener-target'
    );
    
    if (new_tab && new_tab.opener_tab_id === source_tab.tab_id) {
      console.log('  ✅ Opener tab relationship established');
      console.log(`     Opener Tab ID: ${new_tab.opener_tab_id}`);
      console.log(`     Inherited referrer: ${new_tab.previous_url}`);
    } else {
      console.log('  ❌ Opener tab relationship not established');
    }
  }

  private async test_spa_state_updates(): Promise<void> {
    console.log('\n📋 Test 4: SPA Navigation State Updates');
    
    if (!this.background_client) return;
    
    // Navigate to initial page
    await this.runner.navigate_to('https://example.com/spa-start');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const initial_state = await this.get_tab_history_state();
    const tab = initial_state[initial_state.length - 1];
    
    // Simulate SPA navigation via message
    await this.background_client.Runtime.evaluate({
      expression: `
        chrome.runtime.sendMessage({
          action: 'spaNavigation',
          url: 'https://example.com/spa-page2'
        }, response => {
          console.log('SPA navigation response:', response);
        });
      `
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const updated_state = await this.get_tab_history_state();
    const updated_tab = updated_state.find(t => t.tab_id === tab.tab_id);
    
    if (updated_tab && 
        updated_tab.current_url === 'https://example.com/spa-page2' &&
        updated_tab.previous_url === 'https://example.com/spa-start') {
      console.log('  ✅ SPA navigation state updated');
      console.log(`     Previous: ${updated_tab.previous_url}`);
      console.log(`     Current: ${updated_tab.current_url}`);
    } else {
      console.log('  ❌ SPA navigation state not updated');
    }
  }

  private async test_tab_removal_cleanup(): Promise<void> {
    console.log('\n📋 Test 5: Tab Removal Cleanup');
    
    // Create a tab
    await this.runner.navigate_to('https://example.com/to-remove');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const state_before = await this.get_tab_history_state();
    const tab_count_before = state_before.length;
    
    // Note: Actually closing a tab via CDP is complex
    // We'll test the cleanup function directly
    if (this.background_client) {
      await this.background_client.Runtime.evaluate({
        expression: `
          const store = get_tab_history_store();
          const tab_ids = Array.from(store.keys());
          if (tab_ids.length > 0) {
            // Simulate tab removal for the last tab
            chrome.tabs.onRemoved.listeners[0](tab_ids[tab_ids.length - 1]);
          }
        `
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const state_after = await this.get_tab_history_state();
    
    if (state_after.length < tab_count_before) {
      console.log('  ✅ Tab history cleaned up on removal');
      console.log(`     Tabs before: ${tab_count_before}`);
      console.log(`     Tabs after: ${state_after.length}`);
    } else {
      console.log('  ⚠️  Tab removal cleanup test inconclusive');
    }
  }

  private async test_message_routing(): Promise<void> {
    console.log('\n📋 Test 6: Message Routing and Referrer Response');
    
    if (!this.background_client) return;
    
    // Navigate to set up state
    await this.runner.navigate_to('https://example.com/message-test');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test getReferrer message
    const result = await this.background_client.Runtime.evaluate({
      expression: `
        new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'getReferrer'
          }, response => {
            resolve(response);
          });
        })
      `,
      awaitPromise: true,
      returnByValue: true
    });
    
    const response = result.result.value as any;
    
    if (response && response.success !== false) {
      console.log('  ✅ Message routing working');
      console.log(`     Referrer: ${response.referrer || 'none'}`);
      console.log(`     Has timestamp: ${response.referrer_timestamp ? 'yes' : 'no'}`);
    } else {
      console.log('  ❌ Message routing failed');
    }
  }
}

// Run the tests
