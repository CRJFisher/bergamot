#!/usr/bin/env npx tsx
/**
 * Comprehensive test for group tracking across different navigation scenarios
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';

interface TestScenario {
  name: string;
  test: () => Promise<void>;
  validate: (visits: any[]) => { passed: boolean; details: string };
}

class GroupTrackingTests {
  private runner: ExtensionTestRunner;
  private test_server: TestServer;
  private mock_server: MockPKMServer;
  private results: { scenario: string; passed: boolean; details: string }[] = [];

  constructor() {
    this.runner = new ExtensionTestRunner();
    this.test_server = new TestServer(3456);
    this.mock_server = new MockPKMServer(5000);
  }

  async run(): Promise<void> {
    try {
      await this.mock_server.start();
      await this.test_server.start();
      await this.runner.setup({ headless: true });
      
      console.log('\n' + '='.repeat(60));
      console.log('🔍 GROUP TRACKING COMPREHENSIVE TEST');
      console.log('='.repeat(60));
      
      // Test scenarios
      const scenarios: TestScenario[] = [
        {
          name: 'Same-tab navigation maintains group_id',
          test: () => this.test_same_tab_navigation(),
          validate: (visits) => {
            const groups = new Set(visits.map(v => v.group_id));
            return {
              passed: groups.size === 1 && visits.every(v => v.group_id),
              details: groups.size === 1 ? 
                `✅ Same group_id maintained: ${[...groups][0]?.substring(0, 13)}...` :
                `❌ ${groups.size} different groups found`
            };
          }
        },
        {
          name: 'New window.open tab inherits group_id',
          test: () => this.test_window_open(),
          validate: (visits) => {
            const groups = new Set(visits.map(v => v.group_id));
            const has_opener = visits.some(v => v.opener_tab_id);
            return {
              passed: groups.size === 1 && has_opener,
              details: groups.size === 1 && has_opener ? 
                `✅ Child tab inherited group_id with opener_tab_id` :
                `❌ Group inheritance failed`
            };
          }
        },
        {
          name: 'SPA navigation preserves group_id',
          test: () => this.test_spa_navigation(),
          validate: (visits) => {
            const groups = new Set(visits.map(v => v.group_id));
            const spa_visits = visits.filter(v => v.url?.includes('/spa'));
            return {
              passed: groups.size === 1 && spa_visits.length >= 1,
              details: groups.size === 1 ? 
                `✅ SPA routes share group_id` :
                `❌ SPA navigation broke group tracking`
            };
          }
        },
        {
          name: 'Hash navigation preserves group_id',
          test: () => this.test_hash_navigation(),
          validate: (visits) => {
            const groups = new Set(visits.map(v => v.group_id));
            return {
              passed: groups.size === 1,
              details: groups.size === 1 ? 
                `✅ Hash changes maintain group_id` :
                `❌ Hash navigation created new groups`
            };
          }
        },
        {
          name: 'Form submission preserves group_id',
          test: () => this.test_form_submission(),
          validate: (visits) => {
            const groups = new Set(visits.map(v => v.group_id));
            const has_form_result = visits.some(v => v.url?.includes('form-result'));
            return {
              passed: groups.size === 1 && has_form_result,
              details: groups.size === 1 ? 
                `✅ Form submission maintains group_id` :
                `❌ Form submission broke group tracking`
            };
          }
        }
      ];
      
      // Run each scenario
      for (const scenario of scenarios) {
        console.log(`\n📝 Testing: ${scenario.name}`);
        this.mock_server.clear_visits();
        
        await scenario.test();
        await new Promise(r => setTimeout(r, 2000)); // Wait for visits
        
        const visits = this.mock_server.get_visits();
        const result = scenario.validate(visits);
        
        this.results.push({
          scenario: scenario.name,
          passed: result.passed,
          details: result.details
        });
        
        console.log(`   ${result.details}`);
        console.log(`   Visits: ${visits.length}, Tab IDs: ${new Set(visits.map(v => v.tab_id)).size}`);
      }
      
      // Print summary
      this.print_summary();
      
    } finally {
      await this.cleanup();
    }
  }

  private async test_same_tab_navigation(): Promise<void> {
    await this.runner.navigate_to(this.test_server.getUrl('/'));
    await this.wait(1500);
    await this.runner.navigate_to(this.test_server.getUrl('/page1'));
    await this.wait(1500);
    await this.runner.navigate_to(this.test_server.getUrl('/page2'));
    await this.wait(1500);
  }

  private async test_window_open(): Promise<void> {
    await this.runner.navigate_to(this.test_server.getUrl('/page1'));
    await this.wait(1500);
    
    const client = this.runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `window.open('${this.test_server.getUrl('/page2')}', '_blank');`
      });
    }
    await this.wait(2000);
  }

  private async test_spa_navigation(): Promise<void> {
    await this.runner.navigate_to(this.test_server.getUrl('/spa'));
    await this.wait(1500);
    
    const client = this.runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `
          if (window.navigateToPage) {
            window.navigateToPage('/about');
            setTimeout(() => window.navigateToPage('/contact'), 500);
          }
        `
      });
    }
    await this.wait(2000);
  }

  private async test_hash_navigation(): Promise<void> {
    await this.runner.navigate_to(this.test_server.getUrl('/hash-router'));
    await this.wait(1500);
    
    const client = this.runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `
          window.location.hash = '#about';
          setTimeout(() => { window.location.hash = '#contact'; }, 500);
        `
      });
    }
    await this.wait(2000);
  }

  private async test_form_submission(): Promise<void> {
    await this.runner.navigate_to(this.test_server.getUrl('/page2'));
    await this.wait(1500);
    
    const client = this.runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `
          const form = document.querySelector('form');
          if (form) {
            document.querySelector('input[name="query"]').value = 'test';
            form.submit();
          }
        `
      });
    }
    await this.wait(2000);
  }

  private async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private print_summary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 GROUP TRACKING TEST RESULTS');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    this.results.forEach((r, i) => {
      const status = r.passed ? '✅' : '❌';
      console.log(`\n${status} Scenario ${i+1}: ${r.scenario}`);
      console.log(`   ${r.details}`);
    });
    
    console.log('\n' + '-'.repeat(60));
    console.log(`🎯 Overall: ${passed}/${total} scenarios passed (${Math.round(passed/total*100)}%)`);
    
    if (passed === total) {
      console.log('🎉 Perfect! Group tracking works in all scenarios!');
    } else {
      console.log('⚠️ Some scenarios failed - group tracking needs fixes');
    }
  }

  private async cleanup(): Promise<void> {
    await this.runner.cleanup();
    await this.test_server.stop();
    await this.mock_server.stop();
  }
}

// Run tests
const test = new GroupTrackingTests();
test.run()
  .then(() => {
    console.log('\n✅ Test suite completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  });