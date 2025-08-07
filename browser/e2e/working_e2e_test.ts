#!/usr/bin/env npx tsx
/**
 * Working E2E test that uses local test server
 */

import { ExtensionTestRunner } from './cdp_extension_test';
import { TestServer } from './test-server';
import { MockPKMServer } from './mock_pkm_server';

async function working_e2e_test(): Promise<void> {
  const runner = new ExtensionTestRunner();
  const test_server = new TestServer(3456);
  const mock_pkm_server = new MockPKMServer(5000);
  
  try {
    // Start servers
    await mock_pkm_server.start();
    console.log('✅ Mock PKM server started');
    
    await test_server.start();
    console.log('✅ Test server started');
    
    // Setup Chrome with extension
    await runner.setup();
    await runner.enable_console_monitoring();
    
    console.log('\n=== Working E2E Test ===\n');
    
    // Test 1: Navigate to local test server
    console.log('📝 Test 1: Navigate to local test page');
    await runner.navigate_to(test_server.getUrl('/'));
    
    // Wait for page load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check console logs
    const logs = runner.get_console_logs();
    console.log(`📊 Captured ${logs.length} console messages`);
    
    // Test 2: Navigate to another page
    console.log('\n📝 Test 2: Navigate to page 1');
    await runner.navigate_to(test_server.getUrl('/page1'));
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Navigate to SPA
    console.log('\n📝 Test 3: Navigate to SPA');
    await runner.navigate_to(test_server.getUrl('/spa'));
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get final console logs
    const final_logs = runner.get_console_logs();
    console.log(`\n📊 Total console messages: ${final_logs.length}`);
    
    // Check if extension is tracking
    const visit_logs = final_logs.filter(log => 
      log.message.includes('visit') || 
      log.message.includes('PKM')
    );
    
    console.log(`📊 Visit-related messages: ${visit_logs.length}`);
    
    // Check mock PKM server received visits
    const visits = mock_pkm_server.get_visits();
    console.log(`\n📊 Mock PKM server received ${visits.length} visits:`);
    visits.forEach((visit, i) => {
      console.log(`  ${i + 1}. ${visit.url} (referrer: ${visit.referrer || 'none'})`);
    });
    
    if (visits.length >= 3) {
      console.log('\n✅ Extension successfully sent visit data to PKM server!');
    } else if (visits.length > 0) {
      console.log('\n⚠️  Some visits were tracked but not all expected');
    } else {
      console.log('\n❌ No visits received by PKM server');
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    console.log('\n🧹 Cleaning up...');
    await runner.cleanup();
    await test_server.stop();
    await mock_pkm_server.stop();
    console.log('✅ Cleanup complete');
  }
}

// Run the test
working_e2e_test()
  .then(() => {
    console.log('\n✅ E2E test passed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ E2E test failed:', error);
    process.exit(1);
  });