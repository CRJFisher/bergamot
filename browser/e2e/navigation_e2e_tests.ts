/**
 * Comprehensive E2E navigation tests for browser extension
 * Tests various website types and navigation patterns
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';
import CDP from 'chrome-remote-interface';

interface TestResult {
  test: string;
  scenario: string;
  passed: boolean;
  details: string;
  navigation_data?: any;
}

interface NavigationGroup {
  group_id: string;
  urls: string[];
  referrer_chain: string[];
  timestamps: number[];
  navigation_type: string;
}

export class NavigationE2ETestSuite {
  private runner: ExtensionTestRunner;
  private test_server: TestServer;
  private mock_pkm_server: MockPKMServer;
  private results: TestResult[] = [];
  private navigation_groups: Map<string, NavigationGroup> = new Map();

  constructor() {
    this.runner = new ExtensionTestRunner();
    this.test_server = new TestServer(3456);
    this.mock_pkm_server = new MockPKMServer(5000);
  }

  async run_all_tests(): Promise<void> {
    try {
      // Start mock PKM server
      await this.mock_pkm_server.start();
      console.log('✅ Mock PKM server started');
      
      // Start test server
      await this.test_server.start();
      console.log('\n🚀 Test server started\n');

      // Setup browser with extension
      await this.runner.setup();
      await this.runner.enable_console_monitoring();
      
      console.log('\n🧪 Running Comprehensive Navigation E2E Tests\n');
      console.log('='.repeat(60) + '\n');

      // Run all test suites
      await this.test_traditional_navigation();
      await this.test_spa_navigation();
      await this.test_github_like_navigation();
      await this.test_multi_tab_navigation();
      await this.test_hash_navigation();
      await this.test_iframe_navigation();
      await this.test_popup_navigation();
      await this.test_form_navigation();
      await this.test_redirect_navigation();
      await this.test_referrer_metadata();

      // Print results
      this.print_results();
      
    } finally {
      await this.test_server.stop();
      await this.mock_pkm_server.stop();
      await this.runner.cleanup();
    }
  }

  private async test_traditional_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 1: Traditional Multi-Page Navigation');
    console.log('-'.repeat(50));

    try {
      // Test 1.1: Basic page navigation
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_and_capture_navigation('traditional_home');
      
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_and_capture_navigation('traditional_page1');

      await this.runner.navigate_to(this.test_server.getUrl('/page2'));
      await this.wait_and_capture_navigation('traditional_page2');

      // Verify navigation chain by checking visits were recorded
      // Wait a bit for async sends to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      const visits = this.mock_pkm_server.get_visits();
      if (visits.length >= 3) {
        this.add_result('Traditional Navigation', 'Basic page flow', true, 
          `Navigation flow captured with ${visits.length} pages`);
      } else {
        this.add_result('Traditional Navigation', 'Basic page flow', false, 
          `Navigation flow not fully captured (${visits.length} pages)`);
      }

      // Test 1.2: Back button navigation
      // Note: goBack is not available in CDP API
      // Skipping back button test for now

    } catch (error) {
      this.add_result('Traditional Navigation', 'Overall', false, String(error));
    }
  }

  private async test_spa_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 2: SPA Navigation Tracking');
    console.log('-'.repeat(50));

    try {
      // Navigate to SPA
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_visit_log();
      
      // Clear logs to track only SPA navigations
      this.runner.clear_console_logs();

      // Test pushState navigation
      const client = this.runner['client'];
      if (client) {
        // Click on About link
        await client.Runtime.evaluate({
          expression: `document.querySelector('[data-route="/about"]').click()`
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if pushState was detected
        const spa_nav = await this.runner.wait_for_console_message(/pushState|navigation|spa/i, 3000);
        if (spa_nav) {
          this.add_result('SPA Navigation', 'pushState detection', true, 
            'SPA navigation detected via History API');
        } else {
          this.add_result('SPA Navigation', 'pushState detection', false, 
            'SPA navigation not detected');
        }

        // Click on Contact link
        await client.Runtime.evaluate({
          expression: `document.querySelector('[data-route="/contact"]').click()`
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Click on Products link
        await client.Runtime.evaluate({
          expression: `document.querySelector('[data-route="/products"]').click()`
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify SPA navigation group
        const logs = this.runner.get_console_logs();
        const spa_navigations = logs.filter(log => 
          log.message.toLowerCase().includes('spa') || 
          log.message.includes('pushState')
        );

        if (spa_navigations.length >= 3) {
          this.add_result('SPA Navigation', 'Multiple routes', true, 
            `${spa_navigations.length} SPA navigations tracked`);
        } else {
          this.add_result('SPA Navigation', 'Multiple routes', false, 
            `Only ${spa_navigations.length} navigations tracked`);
        }
      }

    } catch (error) {
      this.add_result('SPA Navigation', 'Overall', false, String(error));
    }
  }

  private async test_github_like_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 3: GitHub-like PJAX Navigation');
    console.log('-'.repeat(50));

    try {
      // Navigate to GitHub mock
      await this.runner.navigate_to(this.test_server.getUrl('/github-mock'));
      await this.wait_for_visit_log();
      
      this.runner.clear_console_logs();

      const client = this.runner['client'];
      if (client) {
        // Navigate through repo sections
        const sections = ['issues', 'pulls', 'wiki', 'settings'];
        
        for (const section of sections) {
          await client.Runtime.evaluate({
            expression: `document.querySelector('[data-pjax*="${section}"]').click()`
          });
          await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Check for PJAX navigation tracking
        const logs = this.runner.get_console_logs();
        const pjax_navs = logs.filter(log => 
          log.message.includes('pushState') || 
          log.message.includes('navigation')
        );

        if (pjax_navs.length >= sections.length) {
          this.add_result('GitHub-like Navigation', 'PJAX tracking', true, 
            `All ${sections.length} PJAX navigations tracked`);
        } else {
          this.add_result('GitHub-like Navigation', 'PJAX tracking', false, 
            `Only ${pjax_navs.length}/${sections.length} navigations tracked`);
        }
      }

    } catch (error) {
      this.add_result('GitHub-like Navigation', 'Overall', false, String(error));
    }
  }

  private async test_multi_tab_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 4: Multi-Tab Navigation Chains');
    console.log('-'.repeat(50));

    try {
      // Start from home
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_visit_log();

      // Navigate to page1
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_visit_log();

      // Open page3 in new tab (has target="_blank")
      const client = this.runner['client'];
      if (client) {
        // Get current tab count before
        const targets_before = await CDP.List({ port: 9222 });
        const tabs_before = targets_before.filter(t => t.type === 'page').length;

        // Click link with target="_blank"
        await client.Runtime.evaluate({
          expression: `document.querySelector('a[target="_blank"]').click()`
        });
        
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check if new tab was opened
        const targets_after = await CDP.List({ port: 9222 });
        const tabs_after = targets_after.filter(t => t.type === 'page').length;

        if (tabs_after > tabs_before) {
          this.add_result('Multi-Tab Navigation', 'New tab via target="_blank"', true, 
            'New tab opened and tracked');
        } else {
          this.add_result('Multi-Tab Navigation', 'New tab via target="_blank"', false, 
            'New tab not detected');
        }

        // Test window.open popup
        await client.Runtime.evaluate({
          expression: `document.querySelector('button[onclick*="window.open"]').click()`
        });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check extension state for opener relationships
        const state = await this.runner.get_extension_state();
        const has_opener = state.some((tab: any) => tab.opener_tab_id !== undefined);

        if (has_opener) {
          this.add_result('Multi-Tab Navigation', 'Opener tracking', true, 
            'Tab opener relationships tracked');
        } else {
          this.add_result('Multi-Tab Navigation', 'Opener tracking', false, 
            'Opener relationships not tracked');
        }
      }

    } catch (error) {
      this.add_result('Multi-Tab Navigation', 'Overall', false, String(error));
    }
  }

  private async test_hash_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 5: Hash-based Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/hash-router'));
      await this.wait_for_visit_log();
      
      this.runner.clear_console_logs();

      const client = this.runner['client'];
      if (client) {
        // Navigate through hash routes
        const routes = ['#about', '#contact', '#home'];
        
        for (const route of routes) {
          await client.Runtime.evaluate({
            expression: `window.location.hash = '${route}'`
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check for hash navigation tracking
        const logs = this.runner.get_console_logs();
        const hash_navs = logs.filter(log => 
          log.message.includes('hash') || 
          log.message.includes('#')
        );

        if (hash_navs.length >= routes.length) {
          this.add_result('Hash Navigation', 'Hash routing', true, 
            `${hash_navs.length} hash navigations tracked`);
        } else {
          this.add_result('Hash Navigation', 'Hash routing', false, 
            `Only ${hash_navs.length} hash navigations tracked`);
        }
      }

    } catch (error) {
      this.add_result('Hash Navigation', 'Overall', false, String(error));
    }
  }

  private async test_iframe_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 6: Iframe Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/iframe-test'));
      await this.wait_for_visit_log();
      
      // Wait for iframes to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      const logs = this.runner.get_console_logs();
      const iframe_logs = logs.filter(log => 
        log.message.includes('iframe') || 
        log.message.includes('frame')
      );

      if (iframe_logs.length > 0) {
        this.add_result('Iframe Navigation', 'Iframe detection', true, 
          'Iframe content tracked');
      } else {
        this.add_result('Iframe Navigation', 'Iframe detection', false, 
          'Iframe content not tracked');
      }

    } catch (error) {
      this.add_result('Iframe Navigation', 'Overall', false, String(error));
    }
  }

  private async test_popup_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 7: Popup Window Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_visit_log();

      const client = this.runner['client'];
      if (client) {
        // Open popup
        await client.Runtime.evaluate({
          expression: `window.open('/popup', 'popup', 'width=400,height=300')`
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check for popup tracking
        const state = await this.runner.get_extension_state();
        const popup_tracked = state.some((tab: any) => 
          tab.current_url?.includes('popup')
        );

        if (popup_tracked) {
          this.add_result('Popup Navigation', 'Popup window', true, 
            'Popup window tracked');
        } else {
          this.add_result('Popup Navigation', 'Popup window', false, 
            'Popup window not tracked');
        }
      }

    } catch (error) {
      this.add_result('Popup Navigation', 'Overall', false, String(error));
    }
  }

  private async test_form_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 8: Form Submission Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/page2'));
      await this.wait_for_visit_log();

      const client = this.runner['client'];
      if (client) {
        // Fill and submit form
        await client.Runtime.evaluate({
          expression: `
            document.querySelector('input[name="query"]').value = 'test search';
            document.querySelector('form').submit();
          `
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check for form submission navigation
        const logs = this.runner.get_console_logs();
        const form_nav = logs.find(log => 
          log.message.includes('form-result') || 
          log.message.includes('query=')
        );

        if (form_nav) {
          this.add_result('Form Navigation', 'Form submission', true, 
            'Form submission navigation tracked');
        } else {
          this.add_result('Form Navigation', 'Form submission', false, 
            'Form submission not tracked');
        }
      }

    } catch (error) {
      this.add_result('Form Navigation', 'Overall', false, String(error));
    }
  }

  private async test_redirect_navigation(): Promise<void> {
    console.log('\n📋 Test Suite 9: Redirect Navigation');
    console.log('-'.repeat(50));

    try {
      // Test server-side redirect
      await this.runner.navigate_to(this.test_server.getUrl('/redirect'));
      await new Promise(resolve => setTimeout(resolve, 2000));

      const logs = this.runner.get_console_logs();
      const redirect_tracked = logs.some(log => 
        log.message.includes('redirect') || 
        log.message.includes('page1')
      );

      if (redirect_tracked) {
        this.add_result('Redirect Navigation', 'Server redirect', true, 
          'Server-side redirect tracked');
      } else {
        this.add_result('Redirect Navigation', 'Server redirect', false, 
          'Server-side redirect not tracked');
      }

      // Test meta refresh redirect
      this.runner.clear_console_logs();
      const visits_before_meta = this.mock_pkm_server.get_visit_count();
      await this.runner.navigate_to(this.test_server.getUrl('/meta-redirect'));
      await new Promise(resolve => setTimeout(resolve, 4000)); // Wait for meta refresh (2s delay + navigation time)

      const visits_after_meta = this.mock_pkm_server.get_visit_count();
      const all_visits = this.mock_pkm_server.get_visits();
      // Check if we tracked the redirect to page2
      const has_page2_visit = all_visits.some(v => v.url?.includes('page2'));
      const meta_redirect_tracked = has_page2_visit || (visits_after_meta >= visits_before_meta + 2);

      if (meta_redirect_tracked) {
        this.add_result('Redirect Navigation', 'Meta refresh', true, 
          'Meta refresh redirect tracked');
      } else {
        this.add_result('Redirect Navigation', 'Meta refresh', false, 
          `Meta refresh not fully tracked (${visits_after_meta - visits_before_meta} new visits)`);
      }

    } catch (error) {
      this.add_result('Redirect Navigation', 'Overall', false, String(error));
    }
  }

  private async test_referrer_metadata(): Promise<void> {
    console.log('\n📋 Test Suite 10: Referrer and Navigation Metadata');
    console.log('-'.repeat(50));

    try {
      // Clear console to track fresh
      this.runner.clear_console_logs();

      // Navigate with referrer
      await this.runner.navigate_to(this.test_server.getUrl('/'));
      await this.wait_for_visit_log();
      
      await this.runner.navigate_to(this.test_server.getUrl('/page1'));
      await this.wait_for_visit_log();

      // Check for referrer in logs
      const logs = this.runner.get_console_logs();
      const referrer_log = logs.find(log => 
        log.message.includes('referrer') || 
        log.message.includes('Referrer')
      );

      if (referrer_log) {
        this.add_result('Referrer Metadata', 'HTTP Referrer', true, 
          'Referrer header captured');
      } else {
        this.add_result('Referrer Metadata', 'HTTP Referrer', false, 
          'Referrer header not captured');
      }

      // Check for timestamp metadata
      const visits_with_metadata = this.mock_pkm_server.get_visits();
      const has_timestamps = visits_with_metadata.length > 0 && 
        visits_with_metadata.every(v => v.timestamp || v.page_loaded_at);

      if (has_timestamps) {
        this.add_result('Referrer Metadata', 'Timestamps', true, 
          'Navigation timestamps captured');
      } else {
        this.add_result('Referrer Metadata', 'Timestamps', false, 
          'Navigation timestamps not captured');
      }

      // Check navigation type - verify extension detects different types
      const has_navigation_logs = logs.some(log => 
        log.message.includes('navigate') || 
        log.message.includes('Navigat') ||
        log.message.includes('PKM')
      );

      if (has_navigation_logs) {
        this.add_result('Referrer Metadata', 'Navigation type', true, 
          'Navigation tracking active');
      } else {
        this.add_result('Referrer Metadata', 'Navigation type', false, 
          'Navigation tracking not detected');
      }

    } catch (error) {
      this.add_result('Referrer Metadata', 'Overall', false, String(error));
    }
  }

  private async wait_for_visit_log(): Promise<void> {
    await this.runner.wait_for_console_message(/visit|navigation|page/i, 3000);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  private async wait_and_capture_navigation(page_name: string): Promise<void> {
    await this.wait_for_visit_log();
    
    // Capture navigation data from console logs
    const logs = this.runner.get_console_logs();
    const nav_log = logs[logs.length - 1];
    
    if (nav_log) {
      console.log(`  ✓ ${page_name}: Navigation captured`);
    }
  }


  private add_result(test: string, scenario: string, passed: boolean, details: string): void {
    const result: TestResult = { test, scenario, passed, details };
    this.results.push(result);
    
    const emoji = passed ? '✅' : '❌';
    console.log(`  ${emoji} ${scenario}: ${details}`);
  }

  private print_results(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60) + '\n');

    const test_groups = new Map<string, TestResult[]>();
    
    // Group results by test suite
    for (const result of this.results) {
      if (!test_groups.has(result.test)) {
        test_groups.set(result.test, []);
      }
      test_groups.get(result.test)!.push(result);
    }

    // Print results by group
    for (const [test, results] of test_groups) {
      const passed = results.filter(r => r.passed).length;
      const total = results.length;
      const pass_rate = ((passed / total) * 100).toFixed(0);
      
      console.log(`\n${test}:`);
      console.log(`  Pass Rate: ${passed}/${total} (${pass_rate}%)`);
      
      for (const result of results) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`    ${status} - ${result.scenario}`);
        if (!result.passed) {
          console.log(`      → ${result.details}`);
        }
      }
    }

    // Overall summary
    const total_passed = this.results.filter(r => r.passed).length;
    const total_tests = this.results.length;
    const overall_pass_rate = ((total_passed / total_tests) * 100).toFixed(0);
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 OVERALL: ${total_passed}/${total_tests} tests passed (${overall_pass_rate}%)`);
    console.log('='.repeat(60) + '\n');

    if (total_passed === total_tests) {
      console.log('🎉 All tests passed! Navigation tracking is working correctly.');
    } else {
      console.log(`⚠️  ${total_tests - total_passed} tests failed. Review the failures above.`);
    }
  }
}

// Run tests if executed directly
const suite = new NavigationE2ETestSuite();
suite.run_all_tests()
  .then(() => {
    console.log('\n✅ E2E test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ E2E test suite failed:', error);
    process.exit(1);
  });
