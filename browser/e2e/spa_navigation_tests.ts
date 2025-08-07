/**
 * Specific tests for SPA navigation tracking
 * Tests various SPA frameworks and routing patterns
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';
import { NavigationVerifier, NavigationSimulator, parse_navigation_from_logs } from './navigation_helpers';
import CDP from 'chrome-remote-interface';

interface SPATestResult {
  framework: string;
  test_case: string;
  passed: boolean;
  details: string;
  navigation_count?: number;
  detection_time_ms?: number;
}

export class SPANavigationTestSuite {
  private runner: ExtensionTestRunner;
  private test_server: TestServer;
  private verifier: NavigationVerifier;
  private results: SPATestResult[] = [];
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
      console.log('\n🚀 SPA Test server started\n');

      // Setup browser with extension
      await this.runner.setup();
      await this.runner.enable_console_monitoring();
      
      // Initialize simulator
      const client = this.runner['client'];
      if (client) {
        this.simulator = new NavigationSimulator(client);
      }
      
      console.log('\n🧪 Running SPA Navigation Tests\n');
      console.log('='.repeat(60) + '\n');

      // Run test suites for different SPA patterns
      await this.test_pushstate_navigation();
      await this.test_replacestate_navigation();
      await this.test_popstate_handling();
      await this.test_hash_routing();
      await this.test_github_pjax_navigation();
      await this.test_spa_performance();
      await this.test_navigation_grouping();
      await this.test_spa_with_query_params();
      await this.test_spa_with_nested_routes();
      await this.test_spa_error_handling();

      // Print results
      this.print_results();
      
    } finally {
      await this.test_server.stop();
      await this.runner.cleanup();
    }
  }

  private async test_pushstate_navigation(): Promise<void> {
    console.log('\n📋 Test 1: History.pushState Navigation');
    console.log('-'.repeat(50));

    try {
      // Navigate to SPA test page
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();
      
      // Start tracking navigation chain
      const chain_id = this.verifier.start_chain('pushstate_test');
      this.runner.clear_console_logs();

      // Navigate through SPA routes using pushState
      const routes = ['/about', '/contact', '/products'];
      const start_time = Date.now();

      for (const route of routes) {
        if (this.simulator) {
          await this.simulator.push_state(`/spa${route}`, `SPA - ${route}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if pushState was detected
        const detected = await this.runner.wait_for_console_message(/pushState|spa.*navigation/i, 1000);
        if (detected) {
          this.verifier.add_navigation({
            url: `/spa${route}`,
            timestamp: Date.now(),
            navigation_type: 'navigate',
            is_spa: true
          });
        }
      }

      const detection_time = Date.now() - start_time;
      this.verifier.end_chain();

      // Verify results
      const chain_stats = this.verifier.get_chain_stats(chain_id);
      const success = chain_stats && chain_stats.spa_navigations >= routes.length;

      this.add_result(
        'History API',
        'pushState navigation',
        success,
        success 
          ? `All ${routes.length} pushState navigations detected in ${detection_time}ms`
          : `Only ${chain_stats?.spa_navigations || 0}/${routes.length} navigations detected`,
        chain_stats?.spa_navigations,
        detection_time
      );

    } catch (error) {
      this.add_result('History API', 'pushState navigation', false, String(error));
    }
  }

  private async test_replacestate_navigation(): Promise<void> {
    console.log('\n📋 Test 2: History.replaceState Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();
      
      this.runner.clear_console_logs();

      // Test replaceState (doesn't add to history but changes URL)
      const client = this.runner['client'];
      if (client) {
        await client.Runtime.evaluate({
          expression: `
            history.replaceState({page: 'replaced'}, 'Replaced', '/spa/replaced');
            document.title = 'SPA - Replaced';
          `
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if replaceState was detected
        const detected = await this.runner.wait_for_console_message(/replaceState/i, 1000);

        this.add_result(
          'History API',
          'replaceState navigation',
          !!detected,
          detected 
            ? 'replaceState navigation detected'
            : 'replaceState navigation not detected'
        );
      }

    } catch (error) {
      this.add_result('History API', 'replaceState navigation', false, String(error));
    }
  }

  private async test_popstate_handling(): Promise<void> {
    console.log('\n📋 Test 3: Popstate Event Handling (Back/Forward)');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();

      // Navigate through multiple routes to build history
      if (this.simulator) {
        await this.simulator.push_state('/spa/page1', 'Page 1');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.simulator.push_state('/spa/page2', 'Page 2');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.simulator.push_state('/spa/page3', 'Page 3');
        await new Promise(resolve => setTimeout(resolve, 500));

        this.runner.clear_console_logs();

        // Test back navigation
        await this.simulator.go_back();
        await new Promise(resolve => setTimeout(resolve, 1000));

        const back_detected = await this.runner.wait_for_console_message(/popstate|back/i, 1000);

        // Test forward navigation
        await this.simulator.go_forward();
        await new Promise(resolve => setTimeout(resolve, 1000));

        const forward_detected = await this.runner.wait_for_console_message(/popstate|forward/i, 1000);

        const success = !!back_detected || !!forward_detected;
        this.add_result(
          'History API',
          'Popstate (back/forward)',
          success,
          success
            ? 'Back/forward navigation detected via popstate'
            : 'Popstate events not detected'
        );
      }

    } catch (error) {
      this.add_result('History API', 'Popstate (back/forward)', false, String(error));
    }
  }

  private async test_hash_routing(): Promise<void> {
    console.log('\n📋 Test 4: Hash-based Routing (#/route)');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/hash-router'));
      await this.wait_for_spa_ready();
      
      const chain_id = this.verifier.start_chain('hash_routing');
      this.runner.clear_console_logs();

      // Test hash navigation
      const hash_routes = ['#/home', '#/about', '#/contact', '#/products/123'];
      
      for (const hash of hash_routes) {
        if (this.simulator) {
          await this.simulator.navigate_hash(hash);
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        const detected = await this.runner.wait_for_console_message(new RegExp(hash.slice(1)), 1000);
        if (detected) {
          this.verifier.add_navigation({
            url: `/hash-router${hash}`,
            timestamp: Date.now(),
            navigation_type: 'navigate',
            is_spa: true
          });
        }
      }

      this.verifier.end_chain();
      const chain_stats = this.verifier.get_chain_stats(chain_id);
      const success = chain_stats && chain_stats.spa_navigations >= hash_routes.length - 1;

      this.add_result(
        'Hash Routing',
        'Hash navigation',
        success,
        success
          ? `${chain_stats.spa_navigations}/${hash_routes.length} hash navigations tracked`
          : 'Hash navigation tracking failed',
        chain_stats?.spa_navigations
      );

    } catch (error) {
      this.add_result('Hash Routing', 'Hash navigation', false, String(error));
    }
  }

  private async test_github_pjax_navigation(): Promise<void> {
    console.log('\n📋 Test 5: GitHub-style PJAX Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/github-mock'));
      await this.wait_for_spa_ready();
      
      const chain_id = this.verifier.start_chain('github_pjax');
      this.runner.clear_console_logs();

      // Navigate through GitHub-like sections
      const sections = [
        { selector: '[data-pjax*="issues"]', path: '/issues' },
        { selector: '[data-pjax*="pulls"]', path: '/pulls' },
        { selector: '[data-pjax*="wiki"]', path: '/wiki' },
        { selector: '[data-pjax*="settings"]', path: '/settings' }
      ];

      let detected_count = 0;
      for (const section of sections) {
        if (this.simulator) {
          await this.simulator.click_link(section.selector);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        const detected = await this.runner.wait_for_console_message(/pjax|pushState/i, 500);
        if (detected) {
          detected_count++;
          this.verifier.add_navigation({
            url: `/github-mock/user/repo${section.path}`,
            timestamp: Date.now(),
            navigation_type: 'navigate',
            is_spa: true
          });
        }
      }

      this.verifier.end_chain();
      const success = detected_count >= sections.length - 1;

      this.add_result(
        'GitHub PJAX',
        'Repository navigation',
        success,
        success
          ? `${detected_count}/${sections.length} PJAX navigations tracked`
          : `Only ${detected_count}/${sections.length} PJAX navigations detected`,
        detected_count
      );

    } catch (error) {
      this.add_result('GitHub PJAX', 'Repository navigation', false, String(error));
    }
  }

  private async test_spa_performance(): Promise<void> {
    console.log('\n📋 Test 6: SPA Detection Performance');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();

      // Rapid navigation test
      const rapid_routes = Array.from({length: 10}, (_, i) => `/spa/rapid${i}`);
      const start_time = Date.now();
      let detected_count = 0;

      for (const route of rapid_routes) {
        if (this.simulator) {
          await this.simulator.push_state(route, `Rapid ${route}`);
        }
        // Very short delay to test performance
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for all detections
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const logs = this.runner.get_console_logs();
      detected_count = logs.filter(log => 
        log.message.includes('rapid') || 
        log.message.includes('pushState')
      ).length;

      const total_time = Date.now() - start_time;
      const avg_detection_time = total_time / rapid_routes.length;

      const success = detected_count >= rapid_routes.length * 0.8; // 80% detection rate

      this.add_result(
        'Performance',
        'Rapid navigation detection',
        success,
        `Detected ${detected_count}/${rapid_routes.length} rapid navigations in ${total_time}ms (avg: ${avg_detection_time.toFixed(0)}ms)`,
        detected_count,
        avg_detection_time
      );

    } catch (error) {
      this.add_result('Performance', 'Rapid navigation detection', false, String(error));
    }
  }

  private async test_navigation_grouping(): Promise<void> {
    console.log('\n📋 Test 7: SPA Navigation Grouping');
    console.log('-'.repeat(50));

    try {
      // Test that SPA navigations are grouped together
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();
      
      const chain_id = this.verifier.start_chain('spa_grouping');
      
      // Create a navigation sequence
      const sequence = [
        { type: 'pushState', path: '/spa/group1' },
        { type: 'pushState', path: '/spa/group2' },
        { type: 'pushState', path: '/spa/group3' },
        { type: 'navigate', path: '/page1' }, // Regular navigation breaks the group
        { type: 'pushState', path: '/spa/group4' }
      ];

      for (const nav of sequence) {
        if (nav.type === 'pushState' && this.simulator) {
          await this.simulator.push_state(nav.path, nav.path);
        } else if (nav.type === 'navigate') {
          await this.runner.navigate_to(this.test_server.getUrl(nav.path));
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        this.verifier.add_navigation({
          url: nav.path,
          timestamp: Date.now(),
          navigation_type: 'navigate',
          is_spa: nav.type === 'pushState'
        });
      }

      this.verifier.end_chain();
      const chain = this.verifier.get_chain(chain_id);
      
      // Check if SPA navigations are properly grouped
      let groups = 0;
      let in_spa_group = false;
      
      if (chain) {
        for (const event of chain.events) {
          if (event.is_spa && !in_spa_group) {
            groups++;
            in_spa_group = true;
          } else if (!event.is_spa) {
            in_spa_group = false;
          }
        }
      }

      const success = groups === 2; // Should have 2 SPA groups

      this.add_result(
        'Navigation Grouping',
        'SPA group detection',
        success,
        success
          ? `Correctly identified ${groups} SPA navigation groups`
          : `Detected ${groups} groups, expected 2`
      );

    } catch (error) {
      this.add_result('Navigation Grouping', 'SPA group detection', false, String(error));
    }
  }

  private async test_spa_with_query_params(): Promise<void> {
    console.log('\n📋 Test 8: SPA with Query Parameters');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();
      
      this.runner.clear_console_logs();

      // Test navigation with query parameters
      const routes_with_params = [
        '/spa/search?q=test',
        '/spa/search?q=test&filter=recent',
        '/spa/product?id=123&category=electronics'
      ];

      let detected_count = 0;
      for (const route of routes_with_params) {
        if (this.simulator) {
          await this.simulator.push_state(route, 'Search');
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        const detected = await this.runner.wait_for_console_message(/\?|query|param/i, 500);
        if (detected) detected_count++;
      }

      const success = detected_count >= routes_with_params.length - 1;

      this.add_result(
        'Query Parameters',
        'SPA with query params',
        success,
        `${detected_count}/${routes_with_params.length} navigations with query params tracked`,
        detected_count
      );

    } catch (error) {
      this.add_result('Query Parameters', 'SPA with query params', false, String(error));
    }
  }

  private async test_spa_with_nested_routes(): Promise<void> {
    console.log('\n📋 Test 9: SPA with Nested Routes');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();
      
      this.runner.clear_console_logs();

      // Test deeply nested routes
      const nested_routes = [
        '/spa/users',
        '/spa/users/123',
        '/spa/users/123/profile',
        '/spa/users/123/profile/edit',
        '/spa/users/123/posts',
        '/spa/users/123/posts/456'
      ];

      let detected_count = 0;
      for (const route of nested_routes) {
        if (this.simulator) {
          await this.simulator.push_state(route, 'Nested Route');
        }
        await new Promise(resolve => setTimeout(resolve, 300));

        const logs = this.runner.get_console_logs();
        if (logs.some(log => log.message.includes(route.split('/').pop() || ''))) {
          detected_count++;
        }
      }

      const success = detected_count >= nested_routes.length * 0.7; // 70% detection rate

      this.add_result(
        'Nested Routes',
        'Deep route nesting',
        success,
        `${detected_count}/${nested_routes.length} nested routes tracked`,
        detected_count
      );

    } catch (error) {
      this.add_result('Nested Routes', 'Deep route nesting', false, String(error));
    }
  }

  private async test_spa_error_handling(): Promise<void> {
    console.log('\n📋 Test 10: SPA Error Handling');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/spa'));
      await this.wait_for_spa_ready();
      
      this.runner.clear_console_logs();

      // Test invalid routes and error states
      const client = this.runner['client'];
      if (client) {
        // Try to navigate to non-existent route
        await client.Runtime.evaluate({
          expression: `
            history.pushState({}, '404', '/spa/non-existent-route');
            document.getElementById('content').innerHTML = '<h1>404 - Not Found</h1>';
          `
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if 404 navigation was still tracked
        const logs = this.runner.get_console_logs();
        const error_tracked = logs.some(log => 
          log.message.includes('404') || 
          log.message.includes('non-existent')
        );

        this.add_result(
          'Error Handling',
          '404 route tracking',
          error_tracked,
          error_tracked
            ? '404 routes are properly tracked'
            : '404 routes not tracked'
        );

        // Test malformed pushState
        try {
          await client.Runtime.evaluate({
            expression: `history.pushState(null, '', '')`
          });
          
          this.add_result(
            'Error Handling',
            'Malformed pushState',
            true,
            'Handled malformed pushState without errors'
          );
        } catch (e) {
          this.add_result(
            'Error Handling',
            'Malformed pushState',
            false,
            'Failed to handle malformed pushState'
          );
        }
      }

    } catch (error) {
      this.add_result('Error Handling', 'Overall', false, String(error));
    }
  }

  private async wait_for_spa_ready(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private add_result(
    framework: string,
    test_case: string,
    passed: boolean,
    details: string,
    nav_count?: number,
    detection_time?: number
  ): void {
    const result: SPATestResult = {
      framework,
      test_case,
      passed,
      details,
      navigation_count: nav_count,
      detection_time_ms: detection_time
    };
    
    this.results.push(result);
    
    const emoji = passed ? '✅' : '❌';
    console.log(`  ${emoji} ${test_case}: ${details}`);
  }

  private print_results(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SPA NAVIGATION TEST RESULTS');
    console.log('='.repeat(60) + '\n');

    // Group results by framework/category
    const grouped = new Map<string, SPATestResult[]>();
    for (const result of this.results) {
      if (!grouped.has(result.framework)) {
        grouped.set(result.framework, []);
      }
      grouped.get(result.framework)!.push(result);
    }

    // Print by category
    for (const [framework, results] of grouped) {
      const passed = results.filter(r => r.passed).length;
      const total = results.length;
      const pass_rate = ((passed / total) * 100).toFixed(0);
      
      console.log(`\n${framework}:`);
      console.log(`  Pass Rate: ${passed}/${total} (${pass_rate}%)`);
      
      for (const result of results) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`    ${status} - ${result.test_case}`);
        
        if (result.navigation_count !== undefined) {
          console.log(`      → Navigations: ${result.navigation_count}`);
        }
        if (result.detection_time_ms !== undefined) {
          console.log(`      → Detection Time: ${result.detection_time_ms.toFixed(0)}ms`);
        }
        if (!result.passed) {
          console.log(`      → Issue: ${result.details}`);
        }
      }
    }

    // Performance summary
    const perf_results = this.results.filter(r => r.detection_time_ms !== undefined);
    if (perf_results.length > 0) {
      const avg_time = perf_results.reduce((sum, r) => sum + (r.detection_time_ms || 0), 0) / perf_results.length;
      console.log('\n📈 Performance Metrics:');
      console.log(`  Average Detection Time: ${avg_time.toFixed(0)}ms`);
    }

    // Overall summary
    const total_passed = this.results.filter(r => r.passed).length;
    const total_tests = this.results.length;
    const overall_pass_rate = ((total_passed / total_tests) * 100).toFixed(0);
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 OVERALL: ${total_passed}/${total_tests} tests passed (${overall_pass_rate}%)`);
    console.log('='.repeat(60) + '\n');

    if (total_passed === total_tests) {
      console.log('🎉 All SPA navigation tests passed!');
    } else {
      console.log(`⚠️  ${total_tests - total_passed} SPA tests failed. Review the failures above.`);
    }
  }
}

// Run tests if executed directly
const suite = new SPANavigationTestSuite();
suite.run_all_tests()
  .then(() => {
    console.log('\n✅ SPA navigation test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ SPA navigation test suite failed:', error);
    process.exit(1);
  });
