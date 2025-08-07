import { ExtensionTestRunner } from './cdp_extension_test';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

export class MultiPageTestSuite {
  private runner: ExtensionTestRunner;
  private results: TestResult[] = [];

  constructor() {
    this.runner = new ExtensionTestRunner();
  }

  async run_all_tests(): Promise<void> {
    try {
      await this.runner.setup();
      await this.runner.enable_console_monitoring();
      
      console.log('\n🧪 Running Multi-Page Extension Tests\n');

      // Run test suites
      await this.test_basic_navigation();
      await this.test_new_tab_referrer();
      await this.test_spa_navigation();
      await this.test_complex_navigation_chain();
      await this.test_state_persistence();

      // Print results
      this.print_results();
    } finally {
      await this.runner.cleanup();
    }
  }

  private async test_basic_navigation(): Promise<void> {
    console.log('\n📋 Test 1: Basic Navigation with Referrer');
    
    try {
      // Navigate to first page
      await this.runner.navigate_to('https://example.com');
      await this.wait_for_visit_log();
      
      // Navigate to second page
      await this.runner.navigate_to('https://example.com/page2');
      const referrer_log = await this.runner.wait_for_console_message(/referrer.*example\.com/, 5000);
      
      if (referrer_log && referrer_log.message.includes('example.com')) {
        this.add_result('Basic Navigation', true, 'Referrer correctly tracked');
      } else {
        this.add_result('Basic Navigation', false, 'Referrer not found in logs');
      }
    } catch (error) {
      this.add_result('Basic Navigation', false, String(error));
    }
  }

  private async test_new_tab_referrer(): Promise<void> {
    console.log('\n📋 Test 2: New Tab Referrer Tracking');
    
    try {
      // Navigate to source page
      await this.runner.navigate_to('https://example.com/source');
      await this.wait_for_visit_log();
      
      // Open new tab
      const new_tab_id = await this.runner.open_new_tab('https://example.com/target');
      
      // Check for opener tracking
      const opener_log = await this.runner.wait_for_console_message(/opener_tab_id/, 5000);
      
      // Get extension state
      const state = await this.runner.get_extension_state();
      const has_opener = state.some((tab: any) => tab.opener_tab_id !== undefined);
      
      if (opener_log && has_opener) {
        this.add_result('New Tab Referrer', true, 'Opener tab correctly tracked');
      } else {
        this.add_result('New Tab Referrer', false, 'Opener relationship not established');
      }
    } catch (error) {
      this.add_result('New Tab Referrer', false, String(error));
    }
  }

  private async test_spa_navigation(): Promise<void> {
    console.log('\n📋 Test 3: SPA Navigation Detection');
    
    try {
      // Navigate to a SPA (using React.dev as example)
      await this.runner.navigate_to('https://react.dev');
      await this.wait_for_visit_log();
      
      // Clear logs to see only SPA navigations
      this.runner.clear_console_logs();
      
      // Navigate within SPA
      await this.runner.navigate_to('https://react.dev/learn');
      
      // Check for SPA navigation detection
      const spa_log = await this.runner.wait_for_console_message(/SPA.*navigation|pushState|replaceState/, 5000);
      
      if (spa_log) {
        this.add_result('SPA Navigation', true, 'SPA navigation detected');
      } else {
        this.add_result('SPA Navigation', false, 'SPA navigation not detected');
      }
    } catch (error) {
      this.add_result('SPA Navigation', false, String(error));
    }
  }

  private async test_complex_navigation_chain(): Promise<void> {
    console.log('\n📋 Test 4: Complex Navigation Chain');
    
    try {
      const pages = [
        'https://example.com/start',
        'https://example.com/middle',
        'https://example.com/end'
      ];
      
      // Navigate through chain
      for (const page of pages) {
        await this.runner.navigate_to(page);
        await this.wait_for_visit_log();
      }
      
      // Open new tab from last page
      await this.runner.open_new_tab('https://example.com/new-tab');
      
      // Get final state
      const state = await this.runner.get_extension_state();
      
      // Verify we have history for all tabs
      const has_multiple_tabs = state.length >= 2;
      const all_have_history = state.every((tab: any) => 
        tab.current_url && (tab.previous_url || tab.opener_tab_id)
      );
      
      if (has_multiple_tabs && all_have_history) {
        this.add_result('Complex Navigation', true, `${state.length} tabs tracked with history`);
      } else {
        this.add_result('Complex Navigation', false, 'Not all navigation tracked');
      }
    } catch (error) {
      this.add_result('Complex Navigation', false, String(error));
    }
  }

  private async test_state_persistence(): Promise<void> {
    console.log('\n📋 Test 5: State Persistence Across Sessions');
    
    try {
      // Create navigation history
      await this.runner.navigate_to('https://example.com/page1');
      await this.wait_for_visit_log();
      await this.runner.navigate_to('https://example.com/page2');
      await this.wait_for_visit_log();
      
      // Open multiple tabs
      await this.runner.open_new_tab('https://example.com/tab1');
      await this.runner.open_new_tab('https://example.com/tab2');
      
      // Wait for all operations to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get final state
      const state = await this.runner.get_extension_state();
      
      // Verify state contains all expected data
      const tab_count = state.length;
      const tabs_with_history = state.filter((tab: any) => tab.previous_url).length;
      const tabs_with_openers = state.filter((tab: any) => tab.opener_tab_id).length;
      
      console.log(`\n  📊 State Summary:`);
      console.log(`     Total tabs: ${tab_count}`);
      console.log(`     Tabs with history: ${tabs_with_history}`);
      console.log(`     Tabs with openers: ${tabs_with_openers}`);
      
      if (tab_count >= 3 && tabs_with_history >= 1 && tabs_with_openers >= 2) {
        this.add_result('State Persistence', true, 
          `All state preserved: ${tab_count} tabs, ${tabs_with_history} with history, ${tabs_with_openers} with openers`);
      } else {
        this.add_result('State Persistence', false, 'Some state was lost');
      }
    } catch (error) {
      this.add_result('State Persistence', false, String(error));
    }
  }

  private async wait_for_visit_log(): Promise<void> {
    const log = await this.runner.wait_for_console_message(/Sending visit data|visit logged/, 5000);
    if (!log) {
      console.warn('  ⚠️  Visit log not detected within timeout');
    }
  }

  private add_result(name: string, passed: boolean, details?: string): void {
    this.results.push({ name, passed, details });
    console.log(`  ${passed ? '✅' : '❌'} ${name}: ${details || 'No details'}`);
  }

  private print_results(): void {
    console.log('\n📊 Test Results Summary');
    console.log('═══════════════════════');
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    this.results.forEach(result => {
      console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
      if (!result.passed && result.details) {
        console.log(`   └─ ${result.details}`);
      }
    });
    
    console.log('\n═══════════════════════');
    console.log(`Total: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('\n🎉 All tests passed! Extension state persistence is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Review the logs above for details.');
    }
  }
}

// Run the test suite
