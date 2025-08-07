#!/usr/bin/env npx tsx
/**
 * Quick validation that group tracking is working in main scenarios
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';

async function validate_group_tracking() {
  const runner = new ExtensionTestRunner();
  const test_server = new TestServer(3456);
  const mock_server = new MockPKMServer(5000);
  
  const results: { scenario: string; passed: boolean; details: string }[] = [];
  
  try {
    await mock_server.start();
    await test_server.start();
    await runner.setup({ headless: true });
    
    console.log('🔍 VALIDATING GROUP TRACKING\n');
    
    // Scenario 1: Same-tab navigation
    console.log('1️⃣ Testing same-tab navigation...');
    mock_server.clear_visits();
    await runner.navigate_to(test_server.getUrl('/'));
    await new Promise(r => setTimeout(r, 1500));
    await runner.navigate_to(test_server.getUrl('/page1'));
    await new Promise(r => setTimeout(r, 1500));
    
    let visits = mock_server.get_visits();
    let groups = new Set(visits.map(v => v.group_id));
    results.push({
      scenario: 'Same-tab navigation',
      passed: groups.size === 1 && visits.every(v => v.group_id && v.tab_id),
      details: groups.size === 1 ? `Group maintained: ${[...groups][0]?.substring(0, 13)}` : 'Group broken'
    });
    
    // Scenario 2: New tab with opener
    console.log('2️⃣ Testing new tab with opener...');
    mock_server.clear_visits();
    await runner.navigate_to(test_server.getUrl('/page1'));
    await new Promise(r => setTimeout(r, 1500));
    
    const client = runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `window.open('${test_server.getUrl('/page2')}', '_blank');`
      });
    }
    await new Promise(r => setTimeout(r, 2500));
    
    visits = mock_server.get_visits();
    groups = new Set(visits.map(v => v.group_id));
    const has_opener = visits.some(v => v.opener_tab_id);
    results.push({
      scenario: 'New tab inheritance',
      passed: groups.size === 1 && has_opener,
      details: groups.size === 1 && has_opener ? 'Group inherited with opener' : 'Inheritance failed'
    });
    
    // Print results
    console.log('\n' + '='.repeat(50));
    console.log('📊 GROUP TRACKING VALIDATION RESULTS');
    console.log('='.repeat(50) + '\n');
    
    results.forEach(r => {
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status}: ${r.scenario}`);
      console.log(`        ${r.details}\n`);
    });
    
    const all_passed = results.every(r => r.passed);
    if (all_passed) {
      console.log('🎉 Group tracking is working correctly!');
    } else {
      console.log('⚠️ Some group tracking issues detected');
    }
    
  } finally {
    await runner.cleanup();
    await test_server.stop();
    await mock_server.stop();
  }
}

validate_group_tracking()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });