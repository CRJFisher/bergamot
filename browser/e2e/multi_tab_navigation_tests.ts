/**
 * Multi-tab navigation chain tests
 * Tests tab relationships, opener tracking, and cross-tab navigation
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';
import { NavigationVerifier, NavigationSimulator, get_all_tabs } from './navigation_helpers';
import CDP from 'chrome-remote-interface';

interface TabRelationship {
  tab_id: string;
  parent_tab_id?: string;
  opener_tab_id?: string;
  url: string;
  referrer?: string;
  opened_via: 'target_blank' | 'window_open' | 'middle_click' | 'ctrl_click' | 'context_menu' | 'direct';
  timestamp: number;
}

interface MultiTabTestResult {
  test_name: string;
  scenario: string;
  passed: boolean;
  details: string;
  tabs_created?: number;
  relationships_tracked?: number;
}

export class MultiTabNavigationTestSuite {
  private runner: ExtensionTestRunner;
  private test_server: TestServer;
  private verifier: NavigationVerifier;
  private results: MultiTabTestResult[] = [];
  private tab_relationships: Map<string, TabRelationship> = new Map();
  private simulator: NavigationSimulator | null = null;

  constructor() {
    this.runner = new ExtensionTestRunner();
    this.test_server = new TestServer(3456);
    this.verifier = new NavigationVerifier();
  }

  async run_all_tests(): Promise<void> {
    try {
      // Start test server
      await this.test_server.start();
      console.log('\n🚀 Multi-tab test server started\n');

      // Setup browser with extension
      await this.runner.setup();
      await this.runner.enable_console_monitoring();
      
      // Initialize simulator
      const client = this.runner['client'];
      if (client) {
        this.simulator = new NavigationSimulator(client);
      }
      
      console.log('\n🧪 Running Multi-Tab Navigation Tests\n');
      console.log('='.repeat(60) + '\n');

      // Run test suites
      await this.test_target_blank_links();
      await this.test_window_open();
      await this.test_middle_click();
      await this.test_ctrl_click();
      await this.test_opener_chain();
      await this.test_cross_tab_referrer();
      await this.test_popup_windows();
      await this.test_tab_closing();
      await this.test_background_tabs();
      await this.test_complex_tab_tree();

      // Print results
      this.print_results();
      
    } finally {
      await this.test_server.stop();
      await this.runner.cleanup();
    }
  }

  private async test_target_blank_links(): Promise<void> {
    console.log('\n📋 Test 1: Target="_blank" Link Navigation');
    console.log('-'.repeat(50));

    try {
      // Navigate to page with target="_blank" links
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_navigation();

      // Get initial tab count
      const tabs_before = await get_all_tabs(9222);
      const initial_count = tabs_before.length;

      // Click link with target="_blank"
      const client = this.runner['client'];
      if (client) {
        await client.Runtime.evaluate({
          expression: `
            const link = document.querySelector('a[target="_blank"]');
            if (link) link.click();
          `
        });
        
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check new tab was opened
        const tabs_after = await get_all_tabs(9222);
        const new_tabs = tabs_after.length - initial_count;

        if (new_tabs > 0) {
          // Check for opener relationship in extension state
          const state = await this.runner.get_extension_state();
          const has_opener = state.some((tab: any) => tab.opener_tab_id !== undefined);

          this.add_result(
            'Target Blank',
            'New tab via target="_blank"',
            has_opener,
            has_opener
              ? `New tab opened with opener relationship tracked`
              : `New tab opened but opener relationship not tracked`,
            new_tabs,
            has_opener ? 1 : 0
          );

          // Track relationship
          if (tabs_after.length > tabs_before.length) {
            const new_tab = tabs_after[tabs_after.length - 1];
            this.tab_relationships.set(new_tab.id, {
              tab_id: new_tab.id,
              parent_tab_id: tabs_before[0].id,
              url: new_tab.url,
              opened_via: 'target_blank',
              timestamp: Date.now()
            });
          }
        } else {
          this.add_result(
            'Target Blank',
            'New tab via target="_blank"',
            false,
            'New tab not opened',
            0,
            0
          );
        }
      }

    } catch (error) {
      this.add_result('Target Blank', 'Overall', false, String(error));
    }
  }

  private async test_window_open(): Promise<void> {
    console.log('\n📋 Test 2: Window.open() Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_navigation();

      const tabs_before = await get_all_tabs(9222);

      // Test window.open for new tab
      const client = this.runner['client'];
      if (client) {
        await client.Runtime.evaluate({
          expression: `window.open('${this.test_server.getUrl('/page2')}', '_blank')`
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        const tabs_after = await get_all_tabs(9222);
        const new_tabs = tabs_after.length - tabs_before.length;

        // Test window.open for popup
        await client.Runtime.evaluate({
          expression: `window.open('${this.test_server.getUrl('/popup')}', 'popup', 'width=400,height=300')`
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        const tabs_with_popup = await get_all_tabs(9222);
        const total_new = tabs_with_popup.length - tabs_before.length;

        // Check extension state for opener tracking
        const state = await this.runner.get_extension_state();
        const opener_count = state.filter((tab: any) => tab.opener_tab_id !== undefined).length;

        this.add_result(
          'Window.open',
          'New tabs and popups',
          opener_count >= total_new,
          `Created ${total_new} windows, ${opener_count} with opener tracked`,
          total_new,
          opener_count
        );
      }

    } catch (error) {
      this.add_result('Window.open', 'Overall', false, String(error));
    }
  }

  private async test_middle_click(): Promise<void> {
    console.log('\n📋 Test 3: Middle-Click Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_navigation();

      const tabs_before = await get_all_tabs(9222);

      if (this.simulator) {
        // Simulate middle-click on a link
        await this.simulator.middle_click('a[href="/page1"]');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const tabs_after = await get_all_tabs(9222);
        const new_tabs = tabs_after.length - tabs_before.length;

        this.add_result(
          'Middle Click',
          'Open in new tab',
          new_tabs > 0,
          new_tabs > 0
            ? `Middle-click opened ${new_tabs} new tab(s)`
            : 'Middle-click did not open new tab',
          new_tabs
        );
      }

    } catch (error) {
      this.add_result('Middle Click', 'Overall', false, String(error));
    }
  }

  private async test_ctrl_click(): Promise<void> {
    console.log('\n📋 Test 4: Ctrl+Click Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_navigation();

      const tabs_before = await get_all_tabs(9222);

      if (this.simulator) {
        // Simulate Ctrl+click on a link
        await this.simulator.open_in_new_tab('a[href="/page2"]');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const tabs_after = await get_all_tabs(9222);
        const new_tabs = tabs_after.length - tabs_before.length;

        // Check for opener relationship
        const state = await this.runner.get_extension_state();
        const has_opener = state.some((tab: any) => tab.opener_tab_id !== undefined);

        this.add_result(
          'Ctrl Click',
          'Open in new tab',
          new_tabs > 0 && has_opener,
          `Ctrl+click opened ${new_tabs} tab(s) with opener: ${has_opener}`,
          new_tabs,
          has_opener ? 1 : 0
        );
      }

    } catch (error) {
      this.add_result('Ctrl Click', 'Overall', false, String(error));
    }
  }

  private async test_opener_chain(): Promise<void> {
    console.log('\n📋 Test 5: Opener Chain Persistence');
    console.log('-'.repeat(50));

    try {
      // Create a chain of tabs: A opens B, B opens C
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_navigation();

      const client = this.runner['client'];
      if (client) {
        // Tab A opens Tab B
        await client.Runtime.evaluate({
          expression: `window.open('${this.test_server.getUrl('/page1')}', 'tabB')`
        });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get Tab B and navigate it
        const tabs = await get_all_tabs(9222);
        const tab_b = tabs.find(t => t.url.includes('/page1'));
        
        if (tab_b) {
          // Connect to Tab B
          const tab_b_client = await CDP({ target: tab_b.id, port: 9222 });
          await tab_b_client.Runtime.enable();
          
          // Tab B opens Tab C
          await tab_b_client.Runtime.evaluate({
            expression: `window.open('${this.test_server.getUrl('/page2')}', 'tabC')`
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          await tab_b_client.close();
        }

        // Check extension state for chain
        const state = await this.runner.get_extension_state();
        const tabs_with_opener = state.filter((tab: any) => tab.opener_tab_id !== undefined);
        
        // Should have at least 2 tabs with opener relationships
        const chain_preserved = tabs_with_opener.length >= 2;

        this.add_result(
          'Opener Chain',
          'Multi-hop chain',
          chain_preserved,
          chain_preserved
            ? `Opener chain preserved across ${tabs_with_opener.length} tabs`
            : `Only ${tabs_with_opener.length} opener relationships tracked`,
          tabs.length,
          tabs_with_opener.length
        );
      }

    } catch (error) {
      this.add_result('Opener Chain', 'Overall', false, String(error));
    }
  }

  private async test_cross_tab_referrer(): Promise<void> {
    console.log('\n📋 Test 6: Cross-Tab Referrer Preservation');
    console.log('-'.repeat(50));

    try {
      // Navigate to source page
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_navigation();
      
      this.runner.clear_console_logs();

      const client = this.runner['client'];
      if (client) {
        // Open new tab with referrer
        await client.Runtime.evaluate({
          expression: `
            const link = document.createElement('a');
            link.href = '${this.test_server.getUrl('/page2')}';
            link.target = '_blank';
            link.rel = 'opener';
            document.body.appendChild(link);
            link.click();
          `
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check logs for referrer
        const logs = this.runner.get_console_logs();
        const referrer_log = logs.find(log => 
          log.message.includes('referrer') && 
          log.message.includes('page1')
        );

        this.add_result(
          'Cross-Tab Referrer',
          'Referrer preservation',
          !!referrer_log,
          referrer_log
            ? 'Cross-tab referrer preserved'
            : 'Cross-tab referrer not tracked'
        );
      }

    } catch (error) {
      this.add_result('Cross-Tab Referrer', 'Overall', false, String(error));
    }
  }

  private async test_popup_windows(): Promise<void> {
    console.log('\n📋 Test 7: Popup Window Relationships');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_navigation();

      const tabs_before = await get_all_tabs(9222);

      const client = this.runner['client'];
      if (client) {
        // Open multiple popups
        const popups = [
          { name: 'popup1', url: '/popup', features: 'width=300,height=200' },
          { name: 'popup2', url: '/form-result', features: 'width=400,height=300' },
          { name: 'popup3', url: '/page3', features: 'width=500,height=400' }
        ];

        for (const popup of popups) {
          await client.Runtime.evaluate({
            expression: `window.open('${this.test_server.getUrl(popup.url)}', '${popup.name}', '${popup.features}')`
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const tabs_after = await get_all_tabs(9222);
        const popups_created = tabs_after.length - tabs_before.length;

        // Check extension state for popup tracking
        const state = await this.runner.get_extension_state();
        const popups_with_opener = state.filter((tab: any) => 
          tab.opener_tab_id !== undefined && 
          (tab.current_url?.includes('popup') || tab.current_url?.includes('form-result'))
        );

        this.add_result(
          'Popup Windows',
          'Multiple popups',
          popups_with_opener.length >= 2,
          `Created ${popups_created} popups, ${popups_with_opener.length} with opener tracked`,
          popups_created,
          popups_with_opener.length
        );
      }

    } catch (error) {
      this.add_result('Popup Windows', 'Overall', false, String(error));
    }
  }

  private async test_tab_closing(): Promise<void> {
    console.log('\n📋 Test 8: Tab Closing and Chain Cleanup');
    console.log('-'.repeat(50));

    try {
      // Create tabs
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      const client = this.runner['client'];
      
      if (client) {
        // Open new tab
        await client.Runtime.evaluate({
          expression: `window.open('${this.test_server.getUrl('/page1')}', 'toClose')`
        });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const tabs_before_close = await get_all_tabs(9222);
        const tab_to_close = tabs_before_close.find(t => t.url.includes('/page1'));

        if (tab_to_close) {
          // Close the tab
          await CDP.Close({ id: tab_to_close.id, port: 9222 });
          await new Promise(resolve => setTimeout(resolve, 1000));

          const tabs_after_close = await get_all_tabs(9222);
          const tab_closed = tabs_before_close.length > tabs_after_close.length;

          // Check if extension cleaned up the closed tab
          const state = await this.runner.get_extension_state();
          const closed_tab_still_tracked = state.some((tab: any) => 
            tab.current_url?.includes('/page1')
          );

          this.add_result(
            'Tab Closing',
            'Cleanup on close',
            tab_closed && !closed_tab_still_tracked,
            tab_closed
              ? (closed_tab_still_tracked 
                  ? 'Tab closed but still tracked in extension' 
                  : 'Tab closed and cleaned up properly')
              : 'Tab not closed'
          );
        }
      }

    } catch (error) {
      this.add_result('Tab Closing', 'Overall', false, String(error));
    }
  }

  private async test_background_tabs(): Promise<void> {
    console.log('\n📋 Test 9: Background Tab Navigation Tracking');
    console.log('-'.repeat(50));

    try {
      // Open multiple tabs
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_navigation();

      const client = this.runner['client'];
      if (client) {
        // Open tabs in background
        const background_tabs = ['/page1', '/page2', '/spa'];
        
        for (const path of background_tabs) {
          await client.Runtime.evaluate({
            expression: `window.open('${this.test_server.getUrl(path)}', '_blank')`
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Navigate in background tabs
        const all_tabs = await get_all_tabs(9222);
        let navigations_tracked = 0;

        for (const tab of all_tabs.slice(1)) { // Skip first tab
          try {
            const bg_client = await CDP({ target: tab.id, port: 9222 });
            await bg_client.Page.enable();
            await bg_client.Page.navigate({ url: this.test_server.getUrl('/form-result?q=background') });
            await bg_client.Page.loadEventFired();
            await bg_client.close();
            navigations_tracked++;
          } catch (e) {
            // Tab might have closed
          }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if background navigations were tracked
        const logs = this.runner.get_console_logs();
        const bg_nav_logs = logs.filter(log => log.message.includes('background'));

        this.add_result(
          'Background Tabs',
          'Navigation tracking',
          bg_nav_logs.length > 0,
          `${bg_nav_logs.length}/${navigations_tracked} background navigations tracked`,
          all_tabs.length - 1,
          bg_nav_logs.length
        );
      }

    } catch (error) {
      this.add_result('Background Tabs', 'Overall', false, String(error));
    }
  }

  private async test_complex_tab_tree(): Promise<void> {
    console.log('\n📋 Test 10: Complex Tab Tree Structure');
    console.log('-'.repeat(50));

    try {
      // Create a complex tree:
      // Root -> [Child1, Child2]
      // Child1 -> [Grandchild1, Grandchild2]
      // Child2 -> [Grandchild3]
      
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_navigation();

      const client = this.runner['client'];
      if (client) {
        // Root opens Child1 and Child2
        await client.Runtime.evaluate({
          expression: `
            window.child1 = window.open('${this.test_server.getUrl('/page1')}', 'child1');
            window.child2 = window.open('${this.test_server.getUrl('/page2')}', 'child2');
          `
        });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Connect to Child1 and create grandchildren
        const tabs = await get_all_tabs(9222);
        const child1_tab = tabs.find(t => t.url.includes('/page1'));
        
        if (child1_tab) {
          const child1_client = await CDP({ target: child1_tab.id, port: 9222 });
          await child1_client.Runtime.enable();
          
          await child1_client.Runtime.evaluate({
            expression: `
              window.gc1 = window.open('${this.test_server.getUrl('/spa')}', 'gc1');
              window.gc2 = window.open('${this.test_server.getUrl('/hash-router')}', 'gc2');
            `
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          await child1_client.close();
        }

        // Connect to Child2 and create grandchild
        const child2_tab = tabs.find(t => t.url.includes('/page2'));
        
        if (child2_tab) {
          const child2_client = await CDP({ target: child2_tab.id, port: 9222 });
          await child2_client.Runtime.enable();
          
          await child2_client.Runtime.evaluate({
            expression: `window.gc3 = window.open('${this.test_server.getUrl('/github-mock')}', 'gc3')`
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          await child2_client.close();
        }

        // Check final tab count and relationships
        const final_tabs = await get_all_tabs(9222);
        const state = await this.runner.get_extension_state();
        const tabs_with_opener = state.filter((tab: any) => tab.opener_tab_id !== undefined);

        // Should have created at least 5 new tabs with relationships
        const success = final_tabs.length >= 6 && tabs_with_opener.length >= 4;

        this.add_result(
          'Complex Tree',
          'Multi-level hierarchy',
          success,
          `Created tree with ${final_tabs.length} tabs, ${tabs_with_opener.length} relationships tracked`,
          final_tabs.length - 1,
          tabs_with_opener.length
        );
      }

    } catch (error) {
      this.add_result('Complex Tree', 'Overall', false, String(error));
    }
  }

  private async wait_for_navigation(): Promise<void> {
    await this.runner.wait_for_console_message(/navigation|visit|page/i, 3000);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  private add_result(
    test_name: string,
    scenario: string,
    passed: boolean,
    details: string,
    tabs_created?: number,
    relationships_tracked?: number
  ): void {
    const result: MultiTabTestResult = {
      test_name,
      scenario,
      passed,
      details,
      tabs_created,
      relationships_tracked
    };
    
    this.results.push(result);
    
    const emoji = passed ? '✅' : '❌';
    console.log(`  ${emoji} ${scenario}: ${details}`);
  }

  private print_results(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 MULTI-TAB NAVIGATION TEST RESULTS');
    console.log('='.repeat(60) + '\n');

    // Group results by test
    const grouped = new Map<string, MultiTabTestResult[]>();
    for (const result of this.results) {
      if (!grouped.has(result.test_name)) {
        grouped.set(result.test_name, []);
      }
      grouped.get(result.test_name)!.push(result);
    }

    // Print by category
    for (const [test, results] of grouped) {
      const passed = results.filter(r => r.passed).length;
      const total = results.length;
      const pass_rate = ((passed / total) * 100).toFixed(0);
      
      console.log(`\n${test}:`);
      console.log(`  Pass Rate: ${passed}/${total} (${pass_rate}%)`);
      
      for (const result of results) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`    ${status} - ${result.scenario}`);
        
        if (result.tabs_created !== undefined) {
          console.log(`      → Tabs Created: ${result.tabs_created}`);
        }
        if (result.relationships_tracked !== undefined) {
          console.log(`      → Relationships Tracked: ${result.relationships_tracked}`);
        }
        if (!result.passed) {
          console.log(`      → Issue: ${result.details}`);
        }
      }
    }

    // Tab statistics
    const total_tabs = this.results
      .filter(r => r.tabs_created !== undefined)
      .reduce((sum, r) => sum + (r.tabs_created || 0), 0);
    
    const total_relationships = this.results
      .filter(r => r.relationships_tracked !== undefined)
      .reduce((sum, r) => sum + (r.relationships_tracked || 0), 0);

    console.log('\n📈 Tab Statistics:');
    console.log(`  Total Tabs Created: ${total_tabs}`);
    console.log(`  Total Relationships Tracked: ${total_relationships}`);
    console.log(`  Tracking Rate: ${total_relationships > 0 ? ((total_relationships / total_tabs) * 100).toFixed(0) : 0}%`);

    // Overall summary
    const total_passed = this.results.filter(r => r.passed).length;
    const total_tests = this.results.length;
    const overall_pass_rate = ((total_passed / total_tests) * 100).toFixed(0);
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 OVERALL: ${total_passed}/${total_tests} tests passed (${overall_pass_rate}%)`);
    console.log('='.repeat(60) + '\n');

    if (total_passed === total_tests) {
      console.log('🎉 All multi-tab navigation tests passed!');
    } else {
      console.log(`⚠️  ${total_tests - total_passed} multi-tab tests failed. Review the failures above.`);
    }
  }
}

// Run tests if executed directly
const suite = new MultiTabNavigationTestSuite();
suite.run_all_tests()
  .then(() => {
    console.log('\n✅ Multi-tab navigation test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Multi-tab navigation test suite failed:', error);
    process.exit(1);
  });
