#!/usr/bin/env npx tsx
/**
 * Pure E2E Test - Validates ONLY server-side data
 * No console log checking - true black-box testing
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';

interface NavigationScenario {
  name: string;
  actions: () => Promise<void>;
  validate: (visits: any[]) => { passed: boolean; details: string };
}

class PureServerE2ETest {
  private runner: ExtensionTestRunner;
  private test_server: TestServer;
  private mock_pkm_server: MockPKMServer;
  private results: { scenario: string; passed: boolean; details: string }[] = [];

  constructor() {
    this.runner = new ExtensionTestRunner();
    this.test_server = new TestServer(3456);
    this.mock_pkm_server = new MockPKMServer(5000);
  }

  async run(): Promise<void> {
    try {
      // Start servers
      await this.mock_pkm_server.start();
      console.log('✅ Mock PKM server started');
      
      await this.test_server.start();
      console.log('✅ Test server started');
      
      // Setup Chrome with extension - ALWAYS HEADLESS for CI
      await this.runner.setup({ headless: true });
      console.log('✅ Chrome started in headless mode');
      
      // NO console monitoring - pure server-side validation
      console.log('\n=== Pure Server-Side E2E Test ===');
      console.log('Validating ONLY data received by HTTP server\n');
      
      // Run scenarios
      await this.test_scenario_1_basic_navigation();
      await this.test_scenario_2_spa_navigation();
      await this.test_scenario_3_tab_relationships();
      await this.test_scenario_4_referrer_chain();
      await this.test_scenario_5_metadata_completeness();
      
      // Print results
      this.print_results();
      
    } finally {
      await this.cleanup();
    }
  }

  private async test_scenario_1_basic_navigation(): Promise<void> {
    console.log('📝 Scenario 1: Basic multi-page navigation');
    this.mock_pkm_server.clear_visits();
    
    try {
      // Navigate through multiple pages with timeout wrapper
      console.log('  - Navigating to home page...');
      await this.navigate_with_timeout(this.test_server.getUrl('/'), 5000);
      await this.wait(1000);
      
      console.log('  - Navigating to page1...');
      await this.navigate_with_timeout(this.test_server.getUrl('/page1'), 5000);
      await this.wait(1000);
      
      console.log('  - Navigating to page2...');
      await this.navigate_with_timeout(this.test_server.getUrl('/page2'), 5000);
      await this.wait(1500); // Extra time for last request to complete
    } catch (error) {
      console.log(`  ⚠️ Navigation error: ${error}`);
    }
    
    // Validate server data
    const visits = this.mock_pkm_server.get_visits();
    const passed = visits.length >= 3;
    const details = `Server received ${visits.length} visits`;
    
    // Check URLs are correct
    const expected_urls = ['/', '/page1', '/page2'];
    const all_urls_match = expected_urls.every((url, i) => 
      visits[i]?.url?.includes(url)
    );
    
    this.results.push({
      scenario: 'Basic navigation',
      passed: passed && all_urls_match,
      details: all_urls_match ? details : `${details} but URLs don't match expected`
    });
  }

  private async test_scenario_2_spa_navigation(): Promise<void> {
    console.log('📝 Scenario 2: SPA navigation');
    this.mock_pkm_server.clear_visits();
    
    // Navigate to SPA
    await this.runner.navigate_to(this.test_server.getUrl('/spa'));
    await this.wait(1500);
    
    // Trigger SPA navigation
    const client = this.runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `
          if (window.navigateToPage) {
            window.navigateToPage('/about');
            setTimeout(() => window.navigateToPage('/contact'), 1000);
            setTimeout(() => window.navigateToPage('/products'), 2000);
          }
        `
      });
      await this.wait(2500);
    }
    
    // Validate server data
    const visits = this.mock_pkm_server.get_visits();
    const spa_visits = visits.filter(v => v.url?.includes('/spa'));
    const has_multiple_spa_routes = spa_visits.some(v => 
      v.url?.includes('about') || v.url?.includes('contact') || v.url?.includes('products')
    );
    
    this.results.push({
      scenario: 'SPA navigation',
      passed: spa_visits.length >= 1,
      details: `Server received ${spa_visits.length} SPA visits${has_multiple_spa_routes ? ' including route changes' : ''}`
    });
  }

  private async test_scenario_3_tab_relationships(): Promise<void> {
    console.log('📝 Scenario 3: Tab relationships (opener tracking)');
    this.mock_pkm_server.clear_visits();
    
    // Open initial page (page1 has links)
    await this.runner.navigate_to(this.test_server.getUrl('/page1'));
    await this.wait(1500);
    
    // Open new tab via window.open (real opener relationship)
    const client = this.runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `window.open('${this.test_server.getUrl('/page2')}', '_blank');`
      });
    }
    await this.wait(2000);
    
    // Validate server data
    const visits = this.mock_pkm_server.get_visits();
    const has_referrer = visits.some(v => v.referrer && v.referrer !== '');
    
    // Check for group connection data
    const has_group_id = visits.every(v => v.group_id);
    const has_tab_id = visits.every(v => v.tab_id);
    const has_opener_info = visits.some(v => v.opener_tab_id);
    
    // Check if all visits share the same group_id (key requirement!)
    const unique_group_ids = new Set(visits.map(v => v.group_id).filter(Boolean));
    const shares_group_id = unique_group_ids.size === 1 && has_group_id;
    
    // Test passes if tabs share group_id AND have opener info
    const passed = visits.length >= 2 && shares_group_id && has_opener_info;
    
    let details = `${visits.length} visits`;
    if (shares_group_id) {
      details += `, shared group_id: ${[...unique_group_ids][0]?.substring(0, 8)}...`;
    } else {
      details += `, ${unique_group_ids.size} different group_ids`;
    }
    if (has_opener_info) {
      details += ', opener tracked';
    }
    
    this.results.push({
      scenario: 'Tab relationships',
      passed: passed,
      details: details
    });
  }

  private async test_scenario_4_referrer_chain(): Promise<void> {
    console.log('📝 Scenario 4: Referrer chain preservation');
    this.mock_pkm_server.clear_visits();
    
    // Navigate through a chain
    await this.runner.navigate_to(this.test_server.getUrl('/'));
    await this.wait(1000);
    await this.runner.navigate_to(this.test_server.getUrl('/page1'));
    await this.wait(1000);
    await this.runner.navigate_to(this.test_server.getUrl('/page2'));
    await this.wait(1200);
    
    // Validate referrer chain
    const visits = this.mock_pkm_server.get_visits();
    const has_chain = visits.length >= 3 && 
      visits[1]?.referrer?.includes('localhost:3456') &&
      visits[2]?.referrer?.includes('page1');
    
    this.results.push({
      scenario: 'Referrer chain',
      passed: has_chain,
      details: has_chain ? 'Full referrer chain preserved' : 'Referrer chain broken or incomplete'
    });
  }

  private async test_scenario_5_metadata_completeness(): Promise<void> {
    console.log('📝 Scenario 5: Metadata completeness');
    this.mock_pkm_server.clear_visits();
    
    // Navigate to a page
    await this.runner.navigate_to(this.test_server.getUrl('/page1'));
    await this.wait(1500);
    
    // Validate metadata
    const visits = this.mock_pkm_server.get_visits();
    const visit = visits[0];
    
    const has_required_fields = visit && 
      visit.url &&
      (visit.timestamp || visit.page_loaded_at) &&
      (visit.content !== undefined || visit.text_content !== undefined);
    
    const metadata_fields = visit ? Object.keys(visit) : [];
    
    this.results.push({
      scenario: 'Metadata completeness',
      passed: has_required_fields,
      details: `Visit has ${metadata_fields.length} fields: ${metadata_fields.slice(0, 5).join(', ')}...`
    });
  }

  private async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private async navigate_with_timeout(url: string, timeout_ms: number): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Navigation timeout after ${timeout_ms}ms for ${url}`));
      }, timeout_ms);
      
      try {
        await this.runner.navigate_to(url);
        clearTimeout(timeout);
        resolve();
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private print_results(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PURE SERVER E2E TEST RESULTS');
    console.log('='.repeat(60));
    
    console.log('\nScenario Results:');
    for (const result of this.results) {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${status} - ${result.scenario}: ${result.details}`);
    }
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const pass_rate = Math.round((passed / total) * 100);
    
    console.log(`\n🎯 Overall: ${passed}/${total} scenarios passed (${pass_rate}%)`);
    
    if (passed === total) {
      console.log('🎉 All scenarios passed! Server is receiving correct data.');
    } else {
      const failures = this.results.filter(r => !r.passed);
      console.log('\n⚠️ Failed scenarios:');
      failures.forEach(f => console.log(`  - ${f.scenario}: ${f.details}`));
    }
    
    // Log sample data for debugging
    const all_visits = this.mock_pkm_server.get_visits();
    if (all_visits.length > 0) {
      console.log('\n📋 Sample visit data received by server:');
      console.log(JSON.stringify(all_visits[0], null, 2).split('\n').slice(0, 10).join('\n') + '...');
    }
  }

  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');
    await this.runner.cleanup();
    await this.test_server.stop();
    await this.mock_pkm_server.stop();
    console.log('✅ Cleanup complete');
  }
}

// Run the test
async function main() {
  const test = new PureServerE2ETest();
  try {
    await test.run();
    console.log('\n✅ Pure server E2E test completed');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Pure server E2E test failed:', error);
    process.exit(1);
  }
}

main();