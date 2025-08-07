#!/usr/bin/env npx tsx
/**
 * Debug why group_id is not being inherited between tabs
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
    console.log('✅ Mock server started');
    
    await test_server.start();
    console.log('✅ Test server started');
    
    await runner.setup({ headless: false }); // Use GUI mode to see console logs
    await runner.enable_console_monitoring();
    console.log('✅ Chrome started with extension\n');
    
    console.log('='.repeat(60));
    console.log('🔍 DEBUGGING GROUP_ID INHERITANCE');
    console.log('='.repeat(60));
    
    // Navigate to first page
    console.log('\n1️⃣ Navigating to home page...');
    await runner.navigate_to(test_server.getUrl('/'));
    await new Promise(r => setTimeout(r, 3000)); // Wait for visit to be sent
    
    // Check first visit
    const firstVisits = mock_server.get_visits();
    console.log(`   ✅ First page visited. Total visits: ${firstVisits.length}`);
    if (firstVisits.length > 0) {
      const visit = firstVisits[firstVisits.length - 1];
      console.log(`   📍 URL: ${visit.url}`);
      console.log(`   🆔 group_id: ${visit.group_id || 'NOT SET'}`);
      console.log(`   🏷️ tab_id: ${visit.tab_id || 'NOT SET'}`);
    }
    
    // Clear console logs to see only new tab logs
    runner.clear_console_logs();
    
    // Open new tab
    console.log('\n2️⃣ Opening new tab from home page...');
    await runner.open_new_tab(test_server.getUrl('/page1'));
    await new Promise(r => setTimeout(r, 3000));
    
    // Check second visit
    const allVisits = mock_server.get_visits();
    console.log(`   ✅ New tab opened. Total visits: ${allVisits.length}`);
    
    // Check background script logs
    const logs = runner.get_console_logs();
    console.log('\n📋 Background Script Logs:');
    logs.forEach(log => {
      if (log.message.includes('group_id') || 
          log.message.includes('Tab created') || 
          log.message.includes('opener') ||
          log.message.includes('referrer response')) {
        console.log(`   ${log.message}`);
      }
    });
    
    // Analyze visits
    console.log('\n' + '='.repeat(60));
    console.log('📊 VISIT ANALYSIS');
    console.log('='.repeat(60));
    
    allVisits.forEach((visit, i) => {
      console.log(`\n🔍 Visit ${i + 1}:`);
      console.log(`   URL: ${visit.url}`);
      console.log(`   group_id: ${visit.group_id || '❌ MISSING'}`);
      console.log(`   tab_id: ${visit.tab_id || '❌ MISSING'}`);
      console.log(`   opener_tab_id: ${visit.opener_tab_id || '❌ MISSING'}`);
      console.log(`   Referrer: ${visit.referrer || 'none'}`);
    });
    
    // Check if group_ids match
    if (allVisits.length >= 2) {
      const firstGroupId = allVisits[0].group_id;
      const secondGroupId = allVisits[1].group_id;
      
      console.log('\n' + '='.repeat(60));
      console.log('🔗 GROUP CONNECTION TEST');
      console.log('='.repeat(60));
      
      if (firstGroupId && secondGroupId && firstGroupId === secondGroupId) {
        console.log('✅ SUCCESS: Both tabs share the same group_id!');
        console.log(`   Shared group_id: ${firstGroupId}`);
      } else {
        console.log('❌ FAILURE: Tabs have different group_ids!');
        console.log(`   First tab group_id: ${firstGroupId || 'MISSING'}`);
        console.log(`   Second tab group_id: ${secondGroupId || 'MISSING'}`);
        console.log('\n⚠️ This means navigation sessions are not properly connected!');
      }
    }
    
  } finally {
    await runner.cleanup();
    await test_server.stop();
    await mock_server.stop();
    console.log('\n✅ Test complete');
  }
}

test().catch(console.error);