#!/usr/bin/env npx tsx
/**
 * Test to check what group/connection data is sent for new tabs
 */

import { MockPKMServer } from './mock_pkm_server';
import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';

async function test() {
  const runner = new ExtensionTestRunner();
  const test_server = new TestServer(3456);
  const mock_server = new MockPKMServer(5000);
  
  try {
    await mock_server.start();
    console.log('✅ Mock server started');
    
    await test_server.start();
    console.log('✅ Test server started');
    
    await runner.setup({ headless: true });
    console.log('✅ Chrome started\n');
    
    // Navigate to first page
    console.log('📍 Navigating to home page...');
    await runner.navigate_to(test_server.getUrl('/'));
    await new Promise(r => setTimeout(r, 2000));
    
    // Open new tab
    console.log('📍 Opening new tab...');
    await runner.open_new_tab(test_server.getUrl('/page1'));
    await new Promise(r => setTimeout(r, 2000));
    
    // Check visits
    const visits = mock_server.get_visits();
    console.log('\n' + '='.repeat(60));
    console.log('📊 VISIT DATA ANALYSIS');
    console.log('='.repeat(60));
    console.log(`\nTotal visits received: ${visits.length}`);
    
    visits.forEach((v, i) => {
      console.log(`\n🔍 Visit ${i+1}:`);
      console.log('  URL:', v.url);
      console.log('  Referrer:', v.referrer || 'none');
      
      // Check for grouping fields
      console.log('\n  Group/Connection Fields:');
      console.log('    group_id:', v.group_id || '❌ NOT PRESENT');
      console.log('    navigation_group_id:', v.navigation_group_id || '❌ NOT PRESENT');
      console.log('    opener_tab_id:', v.opener_tab_id || '❌ NOT PRESENT');
      console.log('    tab_id:', v.tab_id || '❌ NOT PRESENT');
      console.log('    parent_tab_id:', v.parent_tab_id || '❌ NOT PRESENT');
      console.log('    session_id:', v.session_id || '❌ NOT PRESENT');
      
      // Show all fields
      console.log('\n  All fields present:');
      const fields = Object.keys(v).filter(k => k !== 'content');
      console.log('   ', fields.join(', '));
    });
    
    // Check if visits are connected
    console.log('\n' + '='.repeat(60));
    console.log('🔗 CONNECTION ANALYSIS');
    console.log('='.repeat(60));
    
    if (visits.length >= 2) {
      const firstVisit = visits[0];
      const secondVisit = visits[1];
      
      // Check various connection methods
      const hasGroupId = firstVisit.group_id && secondVisit.group_id && 
                        firstVisit.group_id === secondVisit.group_id;
      const hasNavGroupId = firstVisit.navigation_group_id && secondVisit.navigation_group_id && 
                           firstVisit.navigation_group_id === secondVisit.navigation_group_id;
      const hasOpenerRelation = secondVisit.opener_tab_id || secondVisit.parent_tab_id;
      const hasReferrer = secondVisit.referrer?.includes(firstVisit.url);
      
      console.log('\n✅ Connection Methods Found:');
      if (hasGroupId) console.log('  ✅ Shared group_id');
      if (hasNavGroupId) console.log('  ✅ Shared navigation_group_id');
      if (hasOpenerRelation) console.log('  ✅ Opener/parent tab relationship');
      if (hasReferrer) console.log('  ✅ Referrer chain');
      
      if (!hasGroupId && !hasNavGroupId && !hasOpenerRelation) {
        console.log('  ⚠️ No explicit group connection found between tabs!');
        console.log('  ⚠️ Tabs are only connected via referrer field');
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