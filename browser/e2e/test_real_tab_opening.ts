#!/usr/bin/env npx tsx
/**
 * Test REAL tab opening with proper opener relationships
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';

async function test() {
  const runner = new ExtensionTestRunner();
  const test_server = new TestServer(3456);
  const mock_server = new MockPKMServer(5000);
  
  try {
    await mock_server.start();
    await test_server.start();
    await runner.setup({ headless: false });
    await runner.enable_console_monitoring();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 TESTING REAL TAB OPENING WITH OPENER RELATIONSHIP');
    console.log('='.repeat(60));
    
    // Navigate to page with links
    console.log('\n1️⃣ Navigating to page1 (has target="_blank" link)...');
    await runner.navigate_to(test_server.getUrl('/page1'));
    await new Promise(r => setTimeout(r, 3000));
    
    const firstVisit = mock_server.get_visits()[0];
    console.log('   First page loaded:');
    console.log(`   - group_id: ${firstVisit?.group_id}`);
    console.log(`   - tab_id: ${firstVisit?.tab_id}`);
    
    // Clear for clean logs
    runner.clear_console_logs();
    mock_server.clear_visits();
    
    // Open new tab via window.open (simulates real user behavior)
    console.log('\n2️⃣ Opening new tab via window.open()...');
    const client = runner['client'];
    if (client) {
      await client.Runtime.evaluate({
        expression: `
          window.open('${test_server.getUrl('/page2')}', '_blank');
        `
      });
    }
    
    await new Promise(r => setTimeout(r, 4000));
    
    // Alternative: Click target="_blank" link
    console.log('\n3️⃣ Also testing with target="_blank" link click...');
    await client.Runtime.evaluate({
      expression: `
        const link = document.querySelector('a[target="_blank"]');
        if (link) {
          link.click();
        }
      `
    });
    
    await new Promise(r => setTimeout(r, 4000));
    
    // Check all visits
    const allVisits = mock_server.get_visits();
    console.log(`\n📊 Total visits after tab opening: ${allVisits.length}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 VISIT DETAILS');
    console.log('='.repeat(60));
    
    allVisits.forEach((visit, i) => {
      console.log(`\n🔍 Visit ${i + 1}:`);
      console.log(`   URL: ${visit.url}`);
      console.log(`   group_id: ${visit.group_id || '❌ MISSING'}`);
      console.log(`   tab_id: ${visit.tab_id || '❌ MISSING'}`);
      console.log(`   opener_tab_id: ${visit.opener_tab_id || '❌ MISSING'}`);
    });
    
    // Check group connections
    console.log('\n' + '='.repeat(60));
    console.log('🔗 GROUP CONNECTION ANALYSIS');
    console.log('='.repeat(60));
    
    const uniqueGroups = new Set(allVisits.map(v => v.group_id).filter(Boolean));
    const hasOpenerRelations = allVisits.some(v => v.opener_tab_id);
    
    if (uniqueGroups.size === 1) {
      console.log('✅ SUCCESS: All tabs share the same group_id!');
      console.log(`   Shared group_id: ${[...uniqueGroups][0]}`);
    } else {
      console.log(`❌ FAILURE: Found ${uniqueGroups.size} different group_ids`);
      uniqueGroups.forEach((g, i) => console.log(`   Group ${i+1}: ${g}`));
    }
    
    if (hasOpenerRelations) {
      console.log('✅ Opener relationships detected');
      allVisits.forEach((v, i) => {
        if (v.opener_tab_id) {
          console.log(`   Visit ${i+1} opened from tab ${v.opener_tab_id}`);
        }
      });
    } else {
      console.log('❌ No opener relationships found');
    }
    
    // Check console logs for background script activity
    const logs = runner.get_console_logs();
    const relevantLogs = logs.filter(log => 
      log.message.includes('Tab created') ||
      log.message.includes('opener') ||
      log.message.includes('group_id')
    );
    
    if (relevantLogs.length > 0) {
      console.log('\n📝 Background Script Activity:');
      relevantLogs.forEach(log => console.log(`   ${log.message}`));
    }
    
  } finally {
    await runner.cleanup();
    await test_server.stop();
    await mock_server.stop();
  }
}

test().catch(console.error);