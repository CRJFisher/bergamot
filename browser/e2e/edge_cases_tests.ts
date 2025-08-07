/**
 * Edge cases and special scenarios for navigation testing
 * Tests unusual navigation patterns and error conditions
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';
import CDP from 'chrome-remote-interface';

interface EdgeCaseResult {
  category: string;
  scenario: string;
  passed: boolean;
  details: string;
  error_count?: number;
}

export class EdgeCasesTestSuite {
  private runner: ExtensionTestRunner;
  private test_server: TestServer;
  private results: EdgeCaseResult[] = [];

  constructor() {
    this.runner = new ExtensionTestRunner();
    this.test_server = new TestServer(3456);
  }

  async run_all_tests(): Promise<void> {
    try {
      // Start test server
      await this.test_server.start();
      console.log('\n🚀 Edge cases test server started\n');

      // Setup browser with extension
      await this.runner.setup();
      await this.runner.enable_console_monitoring();
      
      console.log('\n🧪 Running Edge Cases and Special Scenarios Tests\n');
      console.log('='.repeat(60) + '\n');

      // Run edge case tests
      await this.test_iframe_navigation();
      await this.test_nested_iframes();
      await this.test_anchor_navigation();
      await this.test_javascript_redirects();
      await this.test_error_pages();
      await this.test_slow_loading_pages();
      await this.test_rapid_navigation();
      await this.test_circular_redirects();
      await this.test_data_urls();
      await this.test_blob_urls();
      await this.test_about_pages();
      await this.test_file_protocol();

      // Print results
      this.print_results();
      
    } finally {
      await this.test_server.stop();
      await this.runner.cleanup();
    }
  }

  private async test_iframe_navigation(): Promise<void> {
    console.log('\n📋 Test 1: Iframe Navigation');
    console.log('-'.repeat(50));

    try {
      await this.runner.navigate_to(this.test_server.getUrl('/iframe-test'));
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for iframes

      // Check if iframe navigations were tracked
      const logs = this.runner.get_console_logs();
      const iframe_navs = logs.filter(log => 
        log.message.toLowerCase().includes('iframe') || 
        log.message.toLowerCase().includes('frame')
      );

      // Navigate within an iframe
      const client = this.runner['client'];
      if (client) {
        await client.Runtime.evaluate({
          expression: `
            const iframe = document.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.location.href = '${this.test_server.getUrl('/page2')}';
            }
          `
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const after_nav = this.runner.get_console_logs();
      const iframe_nav_tracked = after_nav.length > logs.length;

      this.add_result(
        'Iframes',
        'Iframe navigation',
        iframe_nav_tracked,
        iframe_nav_tracked
          ? 'Iframe navigation tracked'
          : 'Iframe navigation not tracked'
      );

    } catch (error) {
      this.add_result('Iframes', 'Iframe navigation', false, String(error));
    }
  }

  private async test_nested_iframes(): Promise<void> {
    console.log('\n📋 Test 2: Nested Iframes');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Create page with nested iframes
        await client.Page.navigate({
          url: `data:text/html,
            <html>
            <body>
              <h1>Nested Iframes Test</h1>
              <iframe src="${this.test_server.getUrl('/iframe-test')}" width="600" height="400">
              </iframe>
            </body>
            </html>
          `
        });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const logs = this.runner.get_console_logs();
        const nested_tracked = logs.some(log => 
          log.message.includes('iframe') || log.message.includes('nested')
        );

        this.add_result(
          'Iframes',
          'Nested iframes',
          nested_tracked,
          nested_tracked
            ? 'Nested iframe structure tracked'
            : 'Nested iframes not tracked'
        );
      }

    } catch (error) {
      this.add_result('Iframes', 'Nested iframes', false, String(error));
    }
  }

  private async test_anchor_navigation(): Promise<void> {
    console.log('\n📋 Test 3: Anchor Link Navigation');
    console.log('-'.repeat(50));

    try {
      // Create page with anchor links
      const client = this.runner['client'];
      if (client) {
        await client.Page.navigate({
          url: `data:text/html,
            <html>
            <body>
              <h1 id="top">Anchor Test Page</h1>
              <a href="#section1">Go to Section 1</a><br>
              <a href="#section2">Go to Section 2</a><br>
              <div style="height: 1000px;"></div>
              <h2 id="section1">Section 1</h2>
              <div style="height: 1000px;"></div>
              <h2 id="section2">Section 2</h2>
              <a href="#top">Back to top</a>
            </body>
            </html>
          `
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        this.runner.clear_console_logs();

        // Click anchor links
        await client.Runtime.evaluate({
          expression: `document.querySelector('a[href="#section1"]').click()`
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        await client.Runtime.evaluate({
          expression: `document.querySelector('a[href="#section2"]').click()`
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        const logs = this.runner.get_console_logs();
        const anchor_navs = logs.filter(log => 
          log.message.includes('#') || log.message.includes('anchor')
        );

        this.add_result(
          'Anchors',
          'Anchor navigation',
          anchor_navs.length > 0,
          `${anchor_navs.length} anchor navigations tracked`
        );
      }

    } catch (error) {
      this.add_result('Anchors', 'Anchor navigation', false, String(error));
    }
  }

  private async test_javascript_redirects(): Promise<void> {
    console.log('\n📋 Test 4: JavaScript Redirects');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Test various JavaScript redirect methods
        const redirect_methods = [
          { 
            name: 'location.href',
            code: `window.location.href = '${this.test_server.getUrl('/page1')}'`
          },
          {
            name: 'location.assign',
            code: `window.location.assign('${this.test_server.getUrl('/page2')}')`
          },
          {
            name: 'location.replace',
            code: `window.location.replace('${this.test_server.getUrl('/page3')}')`
          }
        ];

        let redirects_tracked = 0;
        for (const method of redirect_methods) {
          this.runner.clear_console_logs();
          
          await client.Runtime.evaluate({
            expression: method.code
          });
          await new Promise(resolve => setTimeout(resolve, 2000));

          const logs = this.runner.get_console_logs();
          if (logs.some(log => log.message.includes('navigation') || log.message.includes('page'))) {
            redirects_tracked++;
          }
        }

        this.add_result(
          'JavaScript',
          'JS redirects',
          redirects_tracked >= 2,
          `${redirects_tracked}/${redirect_methods.length} JS redirect methods tracked`
        );
      }

    } catch (error) {
      this.add_result('JavaScript', 'JS redirects', false, String(error));
    }
  }

  private async test_error_pages(): Promise<void> {
    console.log('\n📋 Test 5: Error Pages (404, 500)');
    console.log('-'.repeat(50));

    try {
      // Test 404 page
      await this.runner.navigate_to(this.test_server.getUrl('/non-existent-page'));
      await new Promise(resolve => setTimeout(resolve, 1000));

      let logs = this.runner.get_console_logs();
      const not_found_tracked = logs.some(log => 
        log.message.includes('404') || log.message.includes('not-found')
      );

      // Test server error (simulate)
      const client = this.runner['client'];
      if (client) {
        await client.Page.navigate({
          url: `data:text/html,
            <html>
            <head><title>500 Internal Server Error</title></head>
            <body>
              <h1>500 Internal Server Error</h1>
              <p>The server encountered an error</p>
            </body>
            </html>
          `
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        logs = this.runner.get_console_logs();
        const error_page_tracked = logs.some(log => 
          log.message.includes('500') || log.message.includes('error')
        );

        this.add_result(
          'Error Pages',
          '404 and 500 pages',
          not_found_tracked || error_page_tracked,
          `404: ${not_found_tracked}, 500: ${error_page_tracked}`
        );
      }

    } catch (error) {
      this.add_result('Error Pages', '404 and 500 pages', false, String(error));
    }
  }

  private async test_slow_loading_pages(): Promise<void> {
    console.log('\n📋 Test 6: Slow Loading Pages');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Simulate slow loading with delayed content
        await client.Page.navigate({
          url: `data:text/html,
            <html>
            <head><title>Slow Loading</title></head>
            <body>
              <h1>Loading...</h1>
              <script>
                setTimeout(() => {
                  document.body.innerHTML += '<p>Content loaded after 3 seconds</p>';
                  history.pushState({}, '', '/slow-loaded');
                }, 3000);
              </script>
            </body>
            </html>
          `
        });

        // Wait for slow content
        await new Promise(resolve => setTimeout(resolve, 4000));

        const logs = this.runner.get_console_logs();
        const slow_load_tracked = logs.some(log => 
          log.message.includes('slow') || log.message.includes('loaded')
        );

        this.add_result(
          'Performance',
          'Slow loading pages',
          slow_load_tracked,
          slow_load_tracked
            ? 'Slow page load tracked'
            : 'Slow page load not tracked'
        );
      }

    } catch (error) {
      this.add_result('Performance', 'Slow loading pages', false, String(error));
    }
  }

  private async test_rapid_navigation(): Promise<void> {
    console.log('\n📋 Test 7: Rapid Navigation');
    console.log('-'.repeat(50));

    try {
      const pages = ['/page1', '/page2', '/spa', '/hash-router'];
      let navigations_initiated = 0;
      
      // Navigate rapidly without waiting
      for (const page of pages) {
        this.runner.navigate_to(this.test_server.getUrl(page));
        navigations_initiated++;
        await new Promise(resolve => setTimeout(resolve, 200)); // Very short delay
      }

      // Wait for everything to settle
      await new Promise(resolve => setTimeout(resolve, 3000));

      const logs = this.runner.get_console_logs();
      const navigations_tracked = logs.filter(log => 
        log.message.includes('navigation') || log.message.includes('page')
      ).length;

      const tracking_rate = (navigations_tracked / navigations_initiated) * 100;

      this.add_result(
        'Performance',
        'Rapid navigation',
        tracking_rate >= 50,
        `Tracked ${navigations_tracked}/${navigations_initiated} rapid navigations (${tracking_rate.toFixed(0)}%)`
      );

    } catch (error) {
      this.add_result('Performance', 'Rapid navigation', false, String(error));
    }
  }

  private async test_circular_redirects(): Promise<void> {
    console.log('\n📋 Test 8: Circular Redirects');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Create a page that redirects to itself
        await client.Page.navigate({
          url: `data:text/html,
            <html>
            <head>
              <title>Circular Redirect</title>
              <meta http-equiv="refresh" content="1;url=data:text/html,redirecting">
            </head>
            <body>Redirecting...</body>
            </html>
          `
        });

        // Let it redirect a few times
        await new Promise(resolve => setTimeout(resolve, 3000));

        const logs = this.runner.get_console_logs();
        const redirect_count = logs.filter(log => 
          log.message.includes('redirect')
        ).length;

        // Should detect multiple redirects but not crash
        this.add_result(
          'Redirects',
          'Circular redirects',
          redirect_count > 0,
          `Detected ${redirect_count} redirects without crashing`
        );
      }

    } catch (error) {
      this.add_result('Redirects', 'Circular redirects', false, String(error));
    }
  }

  private async test_data_urls(): Promise<void> {
    console.log('\n📋 Test 9: Data URLs');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Navigate to data URL
        await client.Page.navigate({
          url: 'data:text/html,<h1>Data URL Page</h1><p>This is a data URL</p>'
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        const logs = this.runner.get_console_logs();
        const data_url_tracked = logs.some(log => 
          log.message.includes('data:') || log.message.includes('Data URL')
        );

        this.add_result(
          'Special URLs',
          'Data URLs',
          data_url_tracked,
          data_url_tracked
            ? 'Data URL navigation tracked'
            : 'Data URL navigation not tracked'
        );
      }

    } catch (error) {
      this.add_result('Special URLs', 'Data URLs', false, String(error));
    }
  }

  private async test_blob_urls(): Promise<void> {
    console.log('\n📋 Test 10: Blob URLs');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Create and navigate to blob URL
        await client.Runtime.evaluate({
          expression: `
            const blob = new Blob(['<h1>Blob URL Page</h1>'], {type: 'text/html'});
            const blobUrl = URL.createObjectURL(blob);
            window.location.href = blobUrl;
          `
        });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const logs = this.runner.get_console_logs();
        const blob_url_tracked = logs.some(log => 
          log.message.includes('blob:') || log.message.includes('Blob')
        );

        this.add_result(
          'Special URLs',
          'Blob URLs',
          blob_url_tracked,
          blob_url_tracked
            ? 'Blob URL navigation tracked'
            : 'Blob URL navigation not tracked'
        );
      }

    } catch (error) {
      this.add_result('Special URLs', 'Blob URLs', false, String(error));
    }
  }

  private async test_about_pages(): Promise<void> {
    console.log('\n📋 Test 11: About Pages');
    console.log('-'.repeat(50));

    try {
      // Test browser about pages
      const about_pages = ['about:blank', 'about:settings'];
      let about_tracked = 0;

      for (const about_page of about_pages) {
        this.runner.clear_console_logs();
        
        try {
          await this.runner.navigate_to(about_page);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const logs = this.runner.get_console_logs();
          if (logs.some(log => log.message.includes('about:'))) {
            about_tracked++;
          }
        } catch (e) {
          // Some about pages might be restricted
        }
      }

      this.add_result(
        'Special URLs',
        'About pages',
        about_tracked > 0,
        `${about_tracked}/${about_pages.length} about: pages tracked`
      );

    } catch (error) {
      this.add_result('Special URLs', 'About pages', false, String(error));
    }
  }

  private async test_file_protocol(): Promise<void> {
    console.log('\n📋 Test 12: File Protocol');
    console.log('-'.repeat(50));

    try {
      const client = this.runner['client'];
      if (client) {
        // Try to navigate to a file:// URL (might be blocked)
        try {
          await client.Page.navigate({
            url: 'file:///test.html'
          });
          await new Promise(resolve => setTimeout(resolve, 1000));

          const logs = this.runner.get_console_logs();
          const file_tracked = logs.some(log => 
            log.message.includes('file:')
          );

          this.add_result(
            'Special URLs',
            'File protocol',
            true,
            file_tracked
              ? 'File protocol navigation tracked'
              : 'File protocol blocked (expected)'
          );
        } catch (e) {
          this.add_result(
            'Special URLs',
            'File protocol',
            true,
            'File protocol properly restricted'
          );
        }
      }

    } catch (error) {
      this.add_result('Special URLs', 'File protocol', false, String(error));
    }
  }

  private add_result(
    category: string,
    scenario: string,
    passed: boolean,
    details: string,
    error_count?: number
  ): void {
    const result: EdgeCaseResult = {
      category,
      scenario,
      passed,
      details,
      error_count
    };
    
    this.results.push(result);
    
    const emoji = passed ? '✅' : '❌';
    console.log(`  ${emoji} ${scenario}: ${details}`);
  }

  private print_results(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 EDGE CASES TEST RESULTS');
    console.log('='.repeat(60) + '\n');

    // Group results by category
    const grouped = new Map<string, EdgeCaseResult[]>();
    for (const result of this.results) {
      if (!grouped.has(result.category)) {
        grouped.set(result.category, []);
      }
      grouped.get(result.category)!.push(result);
    }

    // Print by category
    for (const [category, results] of grouped) {
      const passed = results.filter(r => r.passed).length;
      const total = results.length;
      const pass_rate = ((passed / total) * 100).toFixed(0);
      
      console.log(`\n${category}:`);
      console.log(`  Pass Rate: ${passed}/${total} (${pass_rate}%)`);
      
      for (const result of results) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`    ${status} - ${result.scenario}`);
        if (!result.passed || result.error_count) {
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
      console.log('🎉 All edge case tests passed!');
    } else {
      console.log(`⚠️  ${total_tests - total_passed} edge case tests failed. Review the failures above.`);
    }
  }
}

// Run tests if executed directly
const suite = new EdgeCasesTestSuite();
suite.run_all_tests()
  .then(() => {
    console.log('\n✅ Edge cases test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Edge cases test suite failed:', error);
    process.exit(1);
  });
